-- Purchases (supplier purchase orders + stock receiving)
--
-- Ports the old Electron ipc/purchase.js handlers (create-purchase,
-- receive-purchase, get-purchases, get-purchase, get-suppliers, add-supplier)
-- to Postgres/Supabase. Run after rls_policies.sql (needs public.current_role()
-- and public.price_history). Safe to re-run.

-- ============================================================
-- 1. suppliers
-- ============================================================
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_person text,
  phone text,
  email text,
  address text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. purchases (the purchase order "header")
-- ============================================================
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  purchase_date timestamptz not null default now(),
  total_amount numeric not null default 0,
  status text not null default 'pending',
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.purchases drop constraint if exists purchases_status_check;
alter table public.purchases add constraint purchases_status_check
  check (status in ('pending', 'received'));

-- ============================================================
-- 3. purchase_items (the purchase order "lines")
-- ============================================================
create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric not null,
  unit_cost numeric not null,
  subtotal numeric not null
);

-- price_history already exists (created/renamed in a prior migration - see
-- rls_policies.sql section 7). receive_purchase() below logs one row per
-- item there on receipt; make sure the purchase-linkage column it needs is
-- present without assuming (or clobbering) the rest of that table's shape.
alter table public.price_history add column if not exists purchase_id uuid references public.purchases(id);

-- ============================================================
-- 4. RLS - gated on the "purchase" permission's role list (Admin, Warehouse)
-- ============================================================
alter table public.suppliers      enable row level security;
alter table public.purchases      enable row level security;
alter table public.purchase_items enable row level security;

drop policy if exists suppliers_rw on public.suppliers;
create policy suppliers_rw on public.suppliers
  for all to authenticated
  using (public.current_role() in ('Admin', 'Warehouse'))
  with check (public.current_role() in ('Admin', 'Warehouse'));

drop policy if exists purchases_rw on public.purchases;
create policy purchases_rw on public.purchases
  for all to authenticated
  using (public.current_role() in ('Admin', 'Warehouse'))
  with check (public.current_role() in ('Admin', 'Warehouse'));

drop policy if exists purchase_items_rw on public.purchase_items;
create policy purchase_items_rw on public.purchase_items
  for all to authenticated
  using (public.current_role() in ('Admin', 'Warehouse'))
  with check (public.current_role() in ('Admin', 'Warehouse'));

-- ============================================================
-- 5. receive_purchase(p_purchase_id)
--    For each line item: blends the existing stock's cost with this
--    batch's cost into a new weighted-average cost_price, bumps
--    current_stock, logs a price_history row, then flips the purchase
--    to 'received'. All atomic - security definer, same style as
--    record_customer_payment() in customers_and_invoices.sql.
-- ============================================================
create or replace function public.receive_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  item record;
  v_old_stock numeric;
  v_old_cost numeric;
  v_new_stock numeric;
  v_new_cost numeric;
begin
  if public.current_role() not in ('Admin', 'Warehouse') then
    raise exception 'not authorized';
  end if;

  select status into v_status from public.purchases where id = p_purchase_id;

  if v_status is null then
    raise exception 'purchase not found';
  end if;

  if v_status = 'received' then
    raise exception 'purchase has already been received';
  end if;

  for item in
    select product_id, quantity, unit_cost
    from public.purchase_items
    where purchase_id = p_purchase_id
  loop
    select current_stock, cost_price into v_old_stock, v_old_cost
    from public.products
    where id = item.product_id
    for update;

    v_new_stock := coalesce(v_old_stock, 0) + item.quantity;

    -- Weighted average cost: blend existing stock's cost with this batch's cost.
    -- Falls back to the old cost if the resulting stock is 0.
    v_new_cost := case when v_new_stock > 0
      then ((coalesce(v_old_stock, 0) * coalesce(v_old_cost, 0)) + (item.quantity * item.unit_cost)) / v_new_stock
      else v_old_cost
    end;

    update public.products
    set current_stock = v_new_stock,
        cost_price = v_new_cost
    where id = item.product_id;

    insert into public.price_history
      (product_id, old_cost_price, new_cost_price, unit_cost, quantity, source, purchase_id)
    values
      (item.product_id, v_old_cost, v_new_cost, item.unit_cost, item.quantity, 'purchase', p_purchase_id);
  end loop;

  update public.purchases set status = 'received' where id = p_purchase_id;
end;
$$;

grant execute on function public.receive_purchase(uuid) to authenticated;
