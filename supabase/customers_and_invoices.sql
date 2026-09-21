-- Customer credit payments (FIFO application against outstanding credit invoices)
--
-- Ports the old Electron ipc/customer.js `record-customer-payment` handler.
-- Run after rls_policies.sql. Safe to re-run.

-- ============================================================
-- 1. invoices needs amount_paid / refunded_amount to track dues
--    (Returns and Daily Closing also depend on these two columns)
-- ============================================================
alter table public.invoices add column if not exists amount_paid numeric not null default 0;
alter table public.invoices add column if not exists refunded_amount numeric not null default 0;

-- Backfill: a non-credit sale is paid in full at the time of sale.
update public.invoices
set amount_paid = total_amount
where payment_mode <> 'credit' and amount_paid = 0;

-- ============================================================
-- 2. customer_payments
-- ============================================================
create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  amount numeric not null,
  payment_mode text not null default 'cash',
  payment_date timestamptz not null default now()
);

alter table public.customer_payments enable row level security;

drop policy if exists customer_payments_select on public.customer_payments;
drop policy if exists customer_payments_insert on public.customer_payments;

create policy customer_payments_select on public.customer_payments
  for select to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Cashier'));

-- Inserts only ever happen through record_customer_payment() below (security
-- definer, so it doesn't need this policy) -- direct client inserts are
-- intentionally left with no matching policy (default deny) so the FIFO
-- application + credit_balance/amount_paid bookkeeping can't be bypassed.

-- ============================================================
-- 3. record_customer_payment(customer_id, amount, payment_mode)
--    Applies a payment to the customer's oldest unpaid credit invoices
--    first (FIFO), then records any leftover as a general/advance
--    payment. Runs as one atomic transaction.
-- ============================================================
create or replace function public.record_customer_payment(
  p_customer_id uuid,
  p_amount numeric,
  p_payment_mode text default 'cash'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  remaining numeric := p_amount;
  applied numeric;
  due numeric;
begin
  if public.current_role() not in ('Admin', 'Manager', 'Cashier') then
    raise exception 'not authorized';
  end if;

  if p_amount <= 0 then
    raise exception 'amount must be greater than 0';
  end if;

  update public.customers
  set credit_balance = credit_balance - p_amount
  where id = p_customer_id;

  for inv in
    select id, total_amount, amount_paid
    from public.invoices
    where customer_id = p_customer_id
      and payment_mode = 'credit'
      and amount_paid < total_amount
    order by invoice_date asc
  loop
    exit when remaining <= 0;

    due := inv.total_amount - inv.amount_paid;
    applied := least(due, remaining);

    update public.invoices set amount_paid = amount_paid + applied where id = inv.id;
    insert into public.customer_payments (customer_id, invoice_id, amount, payment_mode)
    values (p_customer_id, inv.id, applied, p_payment_mode);

    remaining := remaining - applied;
  end loop;

  if remaining > 0 then
    insert into public.customer_payments (customer_id, invoice_id, amount, payment_mode)
    values (p_customer_id, null, remaining, p_payment_mode);
  end if;
end;
$$;

grant execute on function public.record_customer_payment(uuid, numeric, text) to authenticated;
