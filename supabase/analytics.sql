-- Analytics + Dashboard aggregation functions
--
-- Ports the old Electron ipc/analytics.js handlers (SQLite) to Postgres
-- security-definer functions callable via supabase.rpc(...). PostgREST's
-- .select() query builder can't express multi-table joins + GROUP BY, so
-- these all need to be real functions rather than plain .from().select()
-- chains.
--
-- Run after rls_policies.sql. Safe to re-run.
--
-- Role gating:
--   - "analytics"-gated functions (sales_report, profit_analysis,
--     category_performance, sales_trend, product_performance) require
--     public.current_role() in ('Admin', 'Manager') -- the only two roles
--     with the `analytics` permission (see src/renderer/utils/permissions.js
--     FALLBACK_PERMISSIONS).
--   - "login-only" functions (today_sales, top_products,
--     low_stock_products, sales_trend_by_period) feed the Dashboard, which
--     the original Electron backend deliberately left visible to every
--     logged-in role regardless of the `analytics` permission. These only
--     require auth.uid() is not null.

-- ============================================================
-- 1. sales_report(start_date, end_date) -- Analytics page
--    Daily totals: invoice count + revenue, newest first.
-- ============================================================
create or replace function public.sales_report(p_start_date date, p_end_date date)
returns table (
  date date,
  invoice_count bigint,
  total_sales numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_role() not in ('Admin', 'Manager') then
    raise exception 'not authorized';
  end if;

  return query
  select
    i.invoice_date::date as date,
    count(*) as invoice_count,
    sum(i.total_amount) as total_sales
  from public.invoices i
  where i.invoice_date::date between p_start_date and p_end_date
  group by i.invoice_date::date
  order by date desc;
end;
$$;

grant execute on function public.sales_report(date, date) to authenticated;

-- ============================================================
-- 2. profit_analysis(start_date, end_date) -- Analytics page
--    Per-product revenue/cost/profit/margin. Uses the product's CURRENT
--    cost_price (not the cost at time of sale) -- this is a known
--    simplification in the original SQLite source, replicated as-is.
-- ============================================================
create or replace function public.profit_analysis(p_start_date date, p_end_date date)
returns table (
  id uuid,
  name text,
  quantity_sold numeric,
  revenue numeric,
  cost numeric,
  profit numeric,
  margin numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_role() not in ('Admin', 'Manager') then
    raise exception 'not authorized';
  end if;

  return query
  select
    p.id,
    p.name,
    sum(ii.quantity) as quantity_sold,
    sum(ii.subtotal) as revenue,
    sum(ii.quantity * p.cost_price) as cost,
    sum(ii.subtotal) - sum(ii.quantity * p.cost_price) as profit,
    case
      when coalesce(sum(ii.subtotal), 0) = 0 then 0
      else round(((sum(ii.subtotal) - sum(ii.quantity * p.cost_price)) / sum(ii.subtotal)) * 100, 2)
    end as margin
  from public.invoice_items ii
  join public.products p on ii.product_id = p.id
  join public.invoices i on ii.invoice_id = i.id
  where i.invoice_date::date between p_start_date and p_end_date
  group by p.id
  order by profit desc;
end;
$$;

grant execute on function public.profit_analysis(date, date) to authenticated;

-- ============================================================
-- 3. category_performance(start_date, end_date) -- Analytics page
--    LEFT JOIN categories so products with no category still show up
--    (category = null / "Uncategorized" client-side).
-- ============================================================
create or replace function public.category_performance(p_start_date date, p_end_date date)
returns table (
  category text,
  items_sold bigint,
  revenue numeric,
  avg_price numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_role() not in ('Admin', 'Manager') then
    raise exception 'not authorized';
  end if;

  return query
  select
    c.name as category,
    count(ii.id) as items_sold,
    sum(ii.subtotal) as revenue,
    round(avg(ii.subtotal), 2) as avg_price
  from public.invoice_items ii
  join public.products p on ii.product_id = p.id
  left join public.categories c on p.category_id = c.id
  join public.invoices i on ii.invoice_id = i.id
  where i.invoice_date::date between p_start_date and p_end_date
  group by c.id, c.name
  order by revenue desc;
end;
$$;

grant execute on function public.category_performance(date, date) to authenticated;

-- ============================================================
-- 4. sales_trend() -- Analytics page's 30-day chart, no params
-- ============================================================
create or replace function public.sales_trend()
returns table (
  date date,
  sales numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_role() not in ('Admin', 'Manager') then
    raise exception 'not authorized';
  end if;

  return query
  select
    i.invoice_date::date as date,
    sum(i.total_amount) as sales
  from public.invoices i
  where i.invoice_date >= now() - interval '30 days'
  group by i.invoice_date::date
  order by date;
end;
$$;

grant execute on function public.sales_trend() to authenticated;

-- ============================================================
-- 5. product_performance(product_id, start_date, end_date) --
--    Analytics page's per-product drill-down. Returns a single jsonb
--    object { daily: [...], quantity_sold, revenue, profit } so the
--    frontend can consume it exactly like the old IPC payload shape.
-- ============================================================
create or replace function public.product_performance(p_product_id uuid, p_start_date date, p_end_date date)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_daily jsonb;
  v_quantity_sold numeric;
  v_revenue numeric;
  v_profit numeric;
begin
  if public.current_role() not in ('Admin', 'Manager') then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.date), '[]'::jsonb)
  into v_daily
  from (
    select
      i.invoice_date::date as date,
      sum(ii.quantity) as quantity_sold,
      sum(ii.subtotal) as revenue,
      sum(ii.subtotal) - sum(ii.quantity * p.cost_price) as profit
    from public.invoice_items ii
    join public.products p on ii.product_id = p.id
    join public.invoices i on ii.invoice_id = i.id
    where ii.product_id = p_product_id
      and i.invoice_date::date between p_start_date and p_end_date
    group by i.invoice_date::date
  ) t;

  select
    coalesce(sum(ii.quantity), 0),
    coalesce(sum(ii.subtotal), 0),
    coalesce(sum(ii.subtotal) - sum(ii.quantity * p.cost_price), 0)
  into v_quantity_sold, v_revenue, v_profit
  from public.invoice_items ii
  join public.products p on ii.product_id = p.id
  join public.invoices i on ii.invoice_id = i.id
  where ii.product_id = p_product_id
    and i.invoice_date::date between p_start_date and p_end_date;

  return jsonb_build_object(
    'daily', v_daily,
    'quantity_sold', coalesce(v_quantity_sold, 0),
    'revenue', coalesce(v_revenue, 0),
    'profit', coalesce(v_profit, 0)
  );
end;
$$;

grant execute on function public.product_performance(uuid, date, date) to authenticated;

-- ============================================================
-- 6. today_sales() -- Dashboard. Login-only (see header note above).
-- ============================================================
create or replace function public.today_sales()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result jsonb;
  v_profit numeric;
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'invoice_count', coalesce(count(*), 0),
    'total_revenue', coalesce(sum(i.total_amount), 0),
    'cash_received', coalesce(sum(case when i.payment_mode = 'cash' then i.total_amount else 0 end), 0),
    'card_received', coalesce(sum(case when i.payment_mode = 'card' then i.total_amount else 0 end), 0),
    'credit_sales', coalesce(sum(case when i.payment_mode = 'credit' then i.total_amount else 0 end), 0)
  )
  into v_result
  from public.invoices i
  where i.invoice_date::date = current_date;

  select coalesce(sum(ii.subtotal) - sum(ii.quantity * p.cost_price), 0)
  into v_profit
  from public.invoice_items ii
  join public.products p on ii.product_id = p.id
  join public.invoices i on ii.invoice_id = i.id
  where i.invoice_date::date = current_date;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('total_profit', coalesce(v_profit, 0));
end;
$$;

grant execute on function public.today_sales() to authenticated;

-- ============================================================
-- 7. top_products(limit) -- Dashboard. Login-only. All-time (no date
--    filter), ordered by quantity sold.
-- ============================================================
create or replace function public.top_products(p_limit integer default 5)
returns table (
  id uuid,
  name text,
  quantity_sold numeric,
  revenue numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  return query
  select
    p.id,
    p.name,
    sum(ii.quantity) as quantity_sold,
    sum(ii.subtotal) as revenue
  from public.invoice_items ii
  join public.products p on ii.product_id = p.id
  group by p.id
  order by quantity_sold desc
  limit p_limit;
end;
$$;

grant execute on function public.top_products(integer) to authenticated;

-- ============================================================
-- 8. low_stock_products() -- Dashboard. Login-only.
--    PostgREST's .select() filters can't compare two columns of the same
--    row (current_stock <= min_stock_level) directly, so this needs a
--    function. Implemented as a function (rather than a view) to stay
--    consistent with the rest of this file's grant-execute pattern.
--    Excludes is_custom rows (one-off billing items with no real stock).
-- ============================================================
create or replace function public.low_stock_products()
returns table (
  id uuid,
  name text,
  sku text,
  current_stock numeric,
  min_stock_level numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  return query
  select p.id, p.name, p.sku, p.current_stock, p.min_stock_level
  from public.products p
  where p.current_stock <= p.min_stock_level
    and p.is_custom is not true
  order by p.current_stock asc;
end;
$$;

grant execute on function public.low_stock_products() to authenticated;

-- ============================================================
-- 9. sales_trend_by_period({period, startDate, endDate}) -- Dashboard's
--    chart. Login-only. Buckets by day/week/month via date_trunc, which
--    replaces the SQLite strftime-based grouping the original used.
-- ============================================================
create or replace function public.sales_trend_by_period(p_period text, p_start_date date, p_end_date date)
returns table (
  label text,
  sales numeric,
  invoice_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized';
  end if;

  return query
  select
    case
      when p_period = 'weekly' then to_char(date_trunc('week', i.invoice_date), 'YYYY-"W"IW')
      when p_period = 'monthly' then to_char(date_trunc('month', i.invoice_date), 'YYYY-MM')
      else to_char(i.invoice_date::date, 'YYYY-MM-DD')
    end as label,
    sum(i.total_amount) as sales,
    count(*) as invoice_count
  from public.invoices i
  where i.invoice_date::date between p_start_date and p_end_date
  group by label
  order by label;
end;
$$;

grant execute on function public.sales_trend_by_period(text, date, date) to authenticated;
