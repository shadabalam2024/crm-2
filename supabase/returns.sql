-- Returns & refunds
--
-- Ports the old Electron ipc/returns.js handlers (see git history at
-- src/main/ipc/returns.js) into Postgres. Depends on invoices.refunded_amount
-- (added in customers_and_invoices.sql) and public.current_role()
-- (defined in rls_policies.sql) -- run both of those first.
-- Safe to re-run: tables use `create table if not exists`, functions use
-- `create or replace`, policies are dropped and recreated.

-- ============================================================
-- 1. returns / return_items
-- ============================================================
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  return_number text not null unique,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  return_date timestamptz not null default now(),
  reason text,
  refund_amount numeric not null default 0,
  refund_mode text not null default 'cash' check (refund_mode in ('cash', 'credit_adjust')),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id) on delete cascade,
  invoice_item_id uuid not null references public.invoice_items(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  quantity numeric not null,
  unit_price numeric not null,
  subtotal numeric not null,
  restocked boolean not null default false,
  disposition text check (disposition in ('damaged', 'defective', 'other')),
  created_at timestamptz not null default now()
);

create index if not exists returns_invoice_id_idx on public.returns(invoice_id);
create index if not exists returns_customer_id_idx on public.returns(customer_id);
create index if not exists return_items_return_id_idx on public.return_items(return_id);
create index if not exists return_items_invoice_item_id_idx on public.return_items(invoice_item_id);
create index if not exists return_items_product_id_idx on public.return_items(product_id);

-- ============================================================
-- 2. RLS
--    Reads: Admin / Manager / Cashier (same set the `returns` permission
--    is granted to in src/renderer/utils/permissions.js).
--    Inserts only ever happen through create_return() below, which is
--    security definer and so doesn't need a matching policy to work --
--    an insert policy is added anyway for defense-in-depth/consistency,
--    following the precedent set by customer_payments in
--    customers_and_invoices.sql. There is deliberately no update/delete
--    policy: a processed return is never edited or removed from the client.
-- ============================================================
alter table public.returns enable row level security;
alter table public.return_items enable row level security;

drop policy if exists returns_select on public.returns;
drop policy if exists returns_insert on public.returns;
drop policy if exists return_items_select on public.return_items;
drop policy if exists return_items_insert on public.return_items;

create policy returns_select on public.returns
  for select to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy returns_insert on public.returns
  for insert to authenticated
  with check (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy return_items_select on public.return_items
  for select to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy return_items_insert on public.return_items
  for insert to authenticated
  with check (public.current_role() in ('Admin', 'Manager', 'Cashier'));

-- ============================================================
-- 3. create_return(invoice_id, items, reason, refund_mode)
--    One atomic transaction: re-validates every line server-side
--    (quantities, restock/disposition exclusivity, invoice-item
--    ownership), inserts the return + its lines, restocks non-custom
--    products, and updates invoices.refunded_amount /
--    customers.credit_balance.
--
--    p_items is a jsonb array of
--      { "invoice_item_id": uuid, "quantity": number,
--        "restock": boolean, "disposition": "damaged"|"defective"|"other"|null }
-- ============================================================
create or replace function public.create_return(
  p_invoice_id uuid,
  p_items jsonb,
  p_reason text default null,
  p_refund_mode text default 'cash'
)
returns public.returns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice record;
  v_item jsonb;
  v_inv_item record;
  v_already_returned numeric;
  v_returnable numeric;
  v_effective_unit_price numeric;
  v_line_subtotal numeric;
  v_quantity numeric;
  v_restock boolean;
  v_disposition text;
  v_refund_amount numeric := 0;
  v_return_number text;
  v_return public.returns;
  v_product record;
  v_lines jsonb := '[]'::jsonb;
begin
  if public.current_role() not in ('Admin', 'Manager', 'Cashier') then
    raise exception 'not authorized';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one item to return';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found';
  end if;

  if p_refund_mode = 'credit_adjust' then
    if v_invoice.payment_mode <> 'credit' then
      raise exception 'Adjust-against-due is only available for credit invoices';
    end if;
    if v_invoice.customer_id is null then
      raise exception 'This invoice has no linked customer';
    end if;
  end if;

  -- Validate every line first (and build up the rows to insert) before
  -- writing anything, so a bad line rolls back the whole return.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    -- Confirm the invoice_item actually belongs to this invoice -- guards
    -- against forging a line item id from a different invoice.
    select * into v_inv_item
    from public.invoice_items
    where id = (v_item->>'invoice_item_id')::uuid
      and invoice_id = p_invoice_id;

    if not found then
      raise exception 'Invalid invoice item';
    end if;

    select coalesce(sum(quantity), 0) into v_already_returned
    from public.return_items
    where invoice_item_id = v_inv_item.id;

    v_returnable := v_inv_item.quantity - v_already_returned;
    v_quantity := (v_item->>'quantity')::numeric;

    if v_quantity is null or v_quantity <= 0 or v_quantity > v_returnable then
      raise exception 'Invalid return quantity for an item (max returnable: %)', v_returnable;
    end if;

    v_restock := coalesce((v_item->>'restock')::boolean, false);
    v_disposition := nullif(v_item->>'disposition', '');

    if not v_restock and v_disposition is null then
      raise exception 'Select a reason (Damaged/Defective/Other) for any item that is not being restocked';
    end if;

    -- Price net of whatever per-item discount was applied at sale time --
    -- NOT invoice_items.unit_price, which is the pre-discount price.
    v_effective_unit_price := v_inv_item.subtotal / v_inv_item.quantity;
    v_line_subtotal := round(v_effective_unit_price * v_quantity, 2);
    v_refund_amount := v_refund_amount + v_line_subtotal;

    v_lines := v_lines || jsonb_build_object(
      'invoice_item_id', v_inv_item.id,
      'product_id', v_inv_item.product_id,
      'quantity', v_quantity,
      'unit_price', v_effective_unit_price,
      'subtotal', v_line_subtotal,
      'restock', v_restock,
      'disposition', case when v_restock then null else v_disposition end
    );
  end loop;

  select 'RET-' || lpad((coalesce(max(nullif(regexp_replace(return_number, '\D', '', 'g'), '')::integer), 0) + 1)::text, 5, '0')
  into v_return_number
  from public.returns;

  insert into public.returns (return_number, invoice_id, customer_id, reason, refund_amount, refund_mode, user_id)
  values (v_return_number, p_invoice_id, v_invoice.customer_id, p_reason, v_refund_amount, p_refund_mode, auth.uid())
  returning * into v_return;

  for v_item in select * from jsonb_array_elements(v_lines)
  loop
    insert into public.return_items (return_id, invoice_item_id, product_id, quantity, unit_price, subtotal, restocked, disposition)
    values (
      v_return.id,
      (v_item->>'invoice_item_id')::uuid,
      (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric,
      (v_item->>'subtotal')::numeric,
      (v_item->>'restock')::boolean,
      v_item->>'disposition'
    );

    if (v_item->>'restock')::boolean then
      select current_stock, is_custom into v_product
      from public.products where id = (v_item->>'product_id')::uuid;

      if found and not coalesce(v_product.is_custom, false) then
        update public.products
        set current_stock = current_stock + (v_item->>'quantity')::numeric
        where id = (v_item->>'product_id')::uuid;
      end if;
    end if;
  end loop;

  update public.invoices
  set refunded_amount = refunded_amount + v_refund_amount
  where id = p_invoice_id;

  if p_refund_mode = 'credit_adjust' then
    update public.customers
    set credit_balance = credit_balance - v_refund_amount
    where id = v_invoice.customer_id;
  end if;

  return v_return;
end;
$$;

grant execute on function public.create_return(uuid, jsonb, text, text) to authenticated;

-- ============================================================
-- 4. get_invoice_return_details(invoice_id)
--    Returns the invoice's line items, each annotated with
--    already_returned, so the frontend can show
--    returnable = quantity - already_returned per line.
--    (Header info -- bill_number/customer_name/total_amount/etc --
--    is fetched separately by the frontend with a plain
--    supabase.from('invoices').select(...), same as BillingPage does.)
-- ============================================================
create or replace function public.get_invoice_return_details(p_invoice_id uuid)
returns table (
  id uuid,
  invoice_id uuid,
  product_id uuid,
  product_name text,
  quantity numeric,
  unit_price numeric,
  subtotal numeric,
  discount numeric,
  discount_type text,
  discount_value numeric,
  is_custom boolean,
  already_returned numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ii.id,
    ii.invoice_id,
    ii.product_id,
    ii.product_name,
    ii.quantity,
    ii.unit_price,
    ii.subtotal,
    ii.discount,
    ii.discount_type,
    ii.discount_value,
    coalesce(p.is_custom, false) as is_custom,
    coalesce((
      select sum(ri.quantity) from public.return_items ri where ri.invoice_item_id = ii.id
    ), 0) as already_returned
  from public.invoice_items ii
  left join public.products p on p.id = ii.product_id
  where ii.invoice_id = p_invoice_id
    and public.current_role() in ('Admin', 'Manager', 'Cashier');
$$;

grant execute on function public.get_invoice_return_details(uuid) to authenticated;
