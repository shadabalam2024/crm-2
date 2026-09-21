-- Base business schema for CRM
--
-- Run this FIRST, before rls_policies.sql and everything else in supabase/.
-- These are the core tables every page in the app queries (products,
-- categories, customers, invoices, invoice_items, price_history,
-- shop_settings). They were never actually created in this Supabase
-- project -- only `profiles`/`permissions` were (from the SQL you ran
-- earlier) -- which is why rls_policies.sql failed with
-- "relation public.products does not exist".
--
-- Safe to re-run: every statement uses `if not exists`.

-- ============================================================
-- categories
-- ============================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ============================================================
-- products
-- ============================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text,
  barcode text,
  category_id uuid references public.categories(id) on delete set null,
  cost_price numeric not null default 0,
  selling_price numeric not null default 0,
  current_stock numeric not null default 0,
  min_stock_level numeric not null default 5,
  is_custom boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists products_sku_key on public.products (sku) where sku is not null;
create unique index if not exists products_barcode_key on public.products (barcode) where barcode is not null;
create index if not exists products_category_id_idx on public.products(category_id);

-- ============================================================
-- price_history
--    (purchase_id column, referencing public.purchases, is added
--    later by purchase.sql once that table exists)
-- ============================================================
create table if not exists public.price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete cascade,
  old_cost_price numeric,
  new_cost_price numeric,
  unit_cost numeric,
  quantity numeric,
  source text,
  changed_at timestamptz not null default now()
);

create index if not exists price_history_product_id_idx on public.price_history(product_id);

-- ============================================================
-- customers
-- ============================================================
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  address text,
  credit_balance numeric not null default 0,
  is_recurring boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- invoices
--    (amount_paid / refunded_amount are added by
--    customers_and_invoices.sql once this table exists)
-- ============================================================
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  bill_number text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  total_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  gst_amount numeric not null default 0,
  payment_mode text not null default 'cash',
  invoice_date timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invoices_customer_id_idx on public.invoices(customer_id);

-- ============================================================
-- invoice_items
-- ============================================================
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text,
  quantity numeric not null,
  unit_price numeric not null,
  subtotal numeric not null,
  discount numeric not null default 0,
  discount_type text default 'flat',
  discount_value numeric default 0,
  created_at timestamptz not null default now()
);

create index if not exists invoice_items_invoice_id_idx on public.invoice_items(invoice_id);
create index if not exists invoice_items_product_id_idx on public.invoice_items(product_id);

-- ============================================================
-- shop_settings (singleton row, id = 1)
-- ============================================================
create table if not exists public.shop_settings (
  id integer primary key default 1,
  shop_name text,
  shop_address text,
  shop_phone text,
  shop_email text,
  gst_number text,
  gst_rate numeric not null default 0,
  payment_terms text,
  return_policy text,
  logo_path text,
  thermal_printing_enabled boolean not null default false,
  thermal_paper_width integer not null default 80
);

insert into public.shop_settings (id, shop_name)
values (1, 'CRM')
on conflict (id) do nothing;
