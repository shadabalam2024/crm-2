-- Daily Closing (till reconciliation)
--
-- Ports the old Electron ipc/closing.js handlers. Run after rls_policies.sql
-- and customers_and_invoices.sql (needs public.current_role() and
-- public.customer_payments). Safe to re-run.
--
-- Design note: the whole point of this feature is that the server -- never
-- the client -- computes the day's cash figures, so a compromised or buggy
-- frontend can't self-report a false "expected cash" to hide a till
-- shortage. get_closing_preview() and save_daily_closing() both recompute
-- cash_sales / card_sales / credit_sales / payments_received_* / refunds_cash
-- live from invoices / customer_payments / returns -- the client only ever
-- supplies a date, an opening_cash count, an actual_cash count and notes.
--
-- NOTE on public.returns: at the time this file was written, public.returns
-- (return_amount/refund_mode/return_date columns) had not landed yet from
-- its sibling migration. refunds_cash below still references
-- public.returns directly (schema: id, return_number, invoice_id,
-- customer_id, return_date, reason, refund_amount, refund_mode, user_id,
-- created_at) per the agreed contract -- it will exist by the time this
-- file is actually run against the database. If you are running this file
-- before supabase/returns.sql has landed, create that table first.

-- ============================================================
-- 1. daily_closings
-- ============================================================
create table if not exists public.daily_closings (
  id uuid primary key default gen_random_uuid(),
  closing_date date unique not null,
  opening_cash numeric not null default 0,
  cash_sales numeric not null default 0,
  card_sales numeric not null default 0,
  credit_sales numeric not null default 0,
  payments_received_cash numeric not null default 0,
  payments_received_card numeric not null default 0,
  refunds_cash numeric not null default 0,
  expected_cash numeric not null default 0,
  actual_cash numeric not null default 0,
  variance numeric not null default 0,
  notes text,
  closed_by uuid references auth.users(id),
  closed_at timestamptz not null default now()
);

alter table public.daily_closings enable row level security;

drop policy if exists daily_closings_select on public.daily_closings;

create policy daily_closings_select on public.daily_closings
  for select to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Cashier'));

-- Inserts/updates only ever happen through save_daily_closing() below
-- (security definer, so it doesn't need this policy) -- direct client
-- writes are intentionally left with no matching policy (default deny)
-- so a compromised frontend can't write a fabricated expected/actual
-- cash figure straight into the table, bypassing the live recompute.

-- ============================================================
-- 2. get_closing_preview(p_date)
--    Live figures for the date, any already-saved closing for that
--    date, and a suggested opening cash (existing row's opening_cash,
--    else the previous closed day's actual_cash carried forward,
--    else 0).
-- ============================================================
create or replace function public.get_closing_preview(p_date date)
returns table (
  cash_sales numeric,
  card_sales numeric,
  credit_sales numeric,
  payments_received_cash numeric,
  payments_received_card numeric,
  refunds_cash numeric,
  suggested_opening_cash numeric,
  existing_id uuid,
  existing_closing_date date,
  existing_opening_cash numeric,
  existing_actual_cash numeric,
  existing_expected_cash numeric,
  existing_variance numeric,
  existing_notes text,
  existing_closed_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cash_sales numeric := 0;
  v_card_sales numeric := 0;
  v_credit_sales numeric := 0;
  v_payments_cash numeric := 0;
  v_payments_card numeric := 0;
  v_refunds_cash numeric := 0;
  v_existing public.daily_closings;
  v_previous_actual numeric;
begin
  if public.current_role() not in ('Admin', 'Manager', 'Cashier') then
    raise exception 'not authorized';
  end if;

  select
    coalesce(sum(total_amount) filter (where payment_mode = 'cash'), 0),
    coalesce(sum(total_amount) filter (where payment_mode = 'card'), 0),
    coalesce(sum(total_amount) filter (where payment_mode = 'credit'), 0)
  into v_cash_sales, v_card_sales, v_credit_sales
  from public.invoices
  where invoice_date::date = p_date;

  select
    coalesce(sum(amount) filter (where payment_mode = 'cash'), 0),
    coalesce(sum(amount) filter (where payment_mode = 'card'), 0)
  into v_payments_cash, v_payments_card
  from public.customer_payments
  where payment_date::date = p_date;

  select coalesce(sum(refund_amount), 0)
  into v_refunds_cash
  from public.returns
  where return_date::date = p_date and refund_mode = 'cash';

  select * into v_existing from public.daily_closings where closing_date = p_date;

  if v_existing.id is null then
    select dc.actual_cash into v_previous_actual
    from public.daily_closings dc
    where dc.closing_date < p_date
    order by dc.closing_date desc
    limit 1;
  end if;

  return query select
    v_cash_sales,
    v_card_sales,
    v_credit_sales,
    v_payments_cash,
    v_payments_card,
    v_refunds_cash,
    case when v_existing.id is not null then v_existing.opening_cash else coalesce(v_previous_actual, 0) end,
    v_existing.id,
    v_existing.closing_date,
    v_existing.opening_cash,
    v_existing.actual_cash,
    v_existing.expected_cash,
    v_existing.variance,
    v_existing.notes,
    v_existing.closed_at;
end;
$$;

grant execute on function public.get_closing_preview(date) to authenticated;

-- ============================================================
-- 3. save_daily_closing(p_date, p_opening_cash, p_actual_cash, p_notes)
--    Recomputes the figures server-side (ignores anything the client
--    might have sent besides date/opening_cash/actual_cash/notes),
--    then upserts on the unique closing_date -- re-saving the same
--    date overwrites it. closed_by/closed_at are captured here, not
--    passed by the client.
-- ============================================================
create or replace function public.save_daily_closing(
  p_date date,
  p_opening_cash numeric,
  p_actual_cash numeric,
  p_notes text default null
)
returns public.daily_closings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cash_sales numeric := 0;
  v_card_sales numeric := 0;
  v_credit_sales numeric := 0;
  v_payments_cash numeric := 0;
  v_payments_card numeric := 0;
  v_refunds_cash numeric := 0;
  v_expected numeric;
  v_variance numeric;
  v_row public.daily_closings;
begin
  if public.current_role() not in ('Admin', 'Manager', 'Cashier') then
    raise exception 'not authorized';
  end if;

  select
    coalesce(sum(total_amount) filter (where payment_mode = 'cash'), 0),
    coalesce(sum(total_amount) filter (where payment_mode = 'card'), 0),
    coalesce(sum(total_amount) filter (where payment_mode = 'credit'), 0)
  into v_cash_sales, v_card_sales, v_credit_sales
  from public.invoices
  where invoice_date::date = p_date;

  select
    coalesce(sum(amount) filter (where payment_mode = 'cash'), 0),
    coalesce(sum(amount) filter (where payment_mode = 'card'), 0)
  into v_payments_cash, v_payments_card
  from public.customer_payments
  where payment_date::date = p_date;

  select coalesce(sum(refund_amount), 0)
  into v_refunds_cash
  from public.returns
  where return_date::date = p_date and refund_mode = 'cash';

  v_expected := coalesce(p_opening_cash, 0) + v_cash_sales + v_payments_cash - v_refunds_cash;
  v_variance := coalesce(p_actual_cash, 0) - v_expected;

  insert into public.daily_closings (
    closing_date, opening_cash, cash_sales, card_sales, credit_sales,
    payments_received_cash, payments_received_card, refunds_cash,
    expected_cash, actual_cash, variance, notes, closed_by, closed_at
  ) values (
    p_date, coalesce(p_opening_cash, 0), v_cash_sales, v_card_sales, v_credit_sales,
    v_payments_cash, v_payments_card, v_refunds_cash,
    v_expected, coalesce(p_actual_cash, 0), v_variance, p_notes, auth.uid(), now()
  )
  on conflict (closing_date) do update set
    opening_cash = excluded.opening_cash,
    cash_sales = excluded.cash_sales,
    card_sales = excluded.card_sales,
    credit_sales = excluded.credit_sales,
    payments_received_cash = excluded.payments_received_cash,
    payments_received_card = excluded.payments_received_card,
    refunds_cash = excluded.refunds_cash,
    expected_cash = excluded.expected_cash,
    actual_cash = excluded.actual_cash,
    variance = excluded.variance,
    notes = excluded.notes,
    closed_by = excluded.closed_by,
    closed_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.save_daily_closing(date, numeric, numeric, text) to authenticated;

-- ============================================================
-- 4. get_closing_history(p_limit)
--    Saved closings, newest-date-first, joined to profiles for the
--    "closed by" username. A security definer RPC (rather than a
--    plain select + client-side join) because non-Admin roles can
--    only read their own profiles row under RLS, and this history
--    view needs to show who closed each past day regardless of who
--    is currently viewing it.
-- ============================================================
create or replace function public.get_closing_history(p_limit int default 60)
returns table (
  id uuid,
  closing_date date,
  opening_cash numeric,
  cash_sales numeric,
  card_sales numeric,
  credit_sales numeric,
  payments_received_cash numeric,
  payments_received_card numeric,
  refunds_cash numeric,
  expected_cash numeric,
  actual_cash numeric,
  variance numeric,
  notes text,
  closed_by uuid,
  closed_at timestamptz,
  closed_by_username text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_role() not in ('Admin', 'Manager', 'Cashier') then
    raise exception 'not authorized';
  end if;

  return query
  select
    dc.id, dc.closing_date, dc.opening_cash, dc.cash_sales, dc.card_sales, dc.credit_sales,
    dc.payments_received_cash, dc.payments_received_card, dc.refunds_cash,
    dc.expected_cash, dc.actual_cash, dc.variance, dc.notes, dc.closed_by, dc.closed_at,
    p.username as closed_by_username
  from public.daily_closings dc
  left join public.profiles p on p.id = dc.closed_by
  order by dc.closing_date desc
  limit p_limit;
end;
$$;

grant execute on function public.get_closing_history(int) to authenticated;
