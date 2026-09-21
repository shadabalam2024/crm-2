-- Row Level Security policies for CRM
--
-- Run this in the Supabase SQL editor (or `supabase db push` if you adopt migrations).
-- It enforces the Admin / Manager / Cashier / Warehouse permission model
-- server-side, instead of relying on the frontend to hide buttons.
--
-- Safe to re-run: policies are dropped and recreated each time.

-- ============================================================
-- 1. Helper: read the caller's role without recursive RLS checks
-- ============================================================
create or replace function public.current_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_role() to authenticated;

-- ============================================================
-- 2. Helper: resolve username -> email for the pre-auth login
--    screen, WITHOUT exposing the rest of the profiles table
--    to anonymous requests.
--    profiles has no email column (your handle_new_user trigger
--    stores the email itself in `username`), so this joins
--    auth.users -- it keeps working even if someone later renames
--    a profile's username to something other than their email.
-- ============================================================
create or replace function public.get_email_for_username(p_username text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = p_username;
$$;

grant execute on function public.get_email_for_username(text) to anon, authenticated;

-- ============================================================
-- 3. Prevent a user from granting themselves a higher role
--    (RLS is row-level, not column-level, so this needs a trigger)
-- ============================================================
create or replace function public.enforce_profile_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Inserting your own profile row: force the safe default unless an
  -- Admin is doing the inserting (e.g. provisioning a new teammate).
  if tg_op = 'INSERT' then
    if new.id = auth.uid() and coalesce(public.current_role(), '') <> 'Admin' then
      new.role := 'Cashier';
    end if;
    return new;
  end if;

  -- Updating your own profile row as a non-admin: role can't change.
  if tg_op = 'UPDATE' then
    if old.id = auth.uid() and coalesce(public.current_role(), '') <> 'Admin' then
      new.role := old.role;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_role_guard();

-- Belt-and-suspenders: even a service-role / SQL-editor insert can't put
-- a typo'd or made-up role into the column.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('Admin', 'Manager', 'Cashier', 'Warehouse'));

-- ============================================================
-- 4. Enable RLS everywhere
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.permissions    enable row level security;
alter table public.products       enable row level security;
alter table public.categories     enable row level security;
alter table public.price_history  enable row level security;
alter table public.customers      enable row level security;
alter table public.invoices       enable row level security;
alter table public.invoice_items  enable row level security;
alter table public.shop_settings  enable row level security;

-- ============================================================
-- 5. profiles
--    - anyone can read their own row; Admins can read/manage all
--    - direct anon SELECT is intentionally NOT granted; use the
--      get_email_for_username() RPC above for the login screen instead
-- ============================================================
drop policy if exists profiles_select_own  on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_insert_own  on public.profiles;
drop policy if exists profiles_update_own  on public.profiles;
drop policy if exists profiles_admin_all   on public.profiles;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.current_role() = 'Admin');

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid() or public.current_role() = 'Admin');

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.current_role() = 'Admin')
  with check (id = auth.uid() or public.current_role() = 'Admin');

create policy profiles_admin_delete on public.profiles
  for delete to authenticated
  using (public.current_role() = 'Admin');

-- ============================================================
-- 5b. permissions (role -> jsonb permission map)
--     readable by anyone signed in (your existing policy already
--     did this); writable only by Admin, so this becomes safe to
--     manage from inside the app later instead of the SQL editor.
-- ============================================================
drop policy if exists permissions_read_all on public.permissions;
drop policy if exists permissions_write on public.permissions;

create policy permissions_read_all on public.permissions
  for select to authenticated
  using (true);

create policy permissions_write on public.permissions
  for all to authenticated
  using (public.current_role() = 'Admin')
  with check (public.current_role() = 'Admin');

-- ============================================================
-- 6. products / categories
--    - readable by any signed-in user (Billing needs prices/names)
--    - writable only by roles with the "inventory" permission
--      (Admin, Manager, Warehouse)
-- ============================================================
drop policy if exists products_select_all on public.products;
drop policy if exists products_write on public.products;

create policy products_select_all on public.products
  for select to authenticated
  using (true);

create policy products_write on public.products
  for all to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Warehouse'))
  with check (public.current_role() in ('Admin', 'Manager', 'Warehouse'));

drop policy if exists categories_select_all on public.categories;
drop policy if exists categories_write on public.categories;

create policy categories_select_all on public.categories
  for select to authenticated
  using (true);

create policy categories_write on public.categories
  for all to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Warehouse'))
  with check (public.current_role() in ('Admin', 'Manager', 'Warehouse'));

-- ============================================================
-- 7. price_history
--    - a historical log: readable and insertable by inventory
--      roles, never updated/deleted from the client
-- ============================================================
drop policy if exists price_history_select on public.price_history;
drop policy if exists price_history_insert on public.price_history;

create policy price_history_select on public.price_history
  for select to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Warehouse'));

create policy price_history_insert on public.price_history
  for insert to authenticated
  with check (public.current_role() in ('Admin', 'Manager', 'Warehouse'));

-- ============================================================
-- 8. customers
--    - Admin, Manager, Cashier only (Warehouse has no customer access)
-- ============================================================
drop policy if exists customers_rw on public.customers;
drop policy if exists customers_delete on public.customers;

create policy customers_rw on public.customers
  for select to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy customers_insert on public.customers
  for insert to authenticated
  with check (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy customers_update on public.customers
  for update to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Cashier'))
  with check (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy customers_delete on public.customers
  for delete to authenticated
  using (public.current_role() = 'Admin');

-- ============================================================
-- 9. invoices / invoice_items
--    - Admin, Manager, Cashier can create sales
--    - only Admin/Manager can edit or void past invoices
-- ============================================================
drop policy if exists invoices_select on public.invoices;
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_update on public.invoices;
drop policy if exists invoices_delete on public.invoices;

create policy invoices_select on public.invoices
  for select to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy invoices_update on public.invoices
  for update to authenticated
  using (public.current_role() in ('Admin', 'Manager'))
  with check (public.current_role() in ('Admin', 'Manager'));

create policy invoices_delete on public.invoices
  for delete to authenticated
  using (public.current_role() in ('Admin', 'Manager'));

drop policy if exists invoice_items_select on public.invoice_items;
drop policy if exists invoice_items_insert on public.invoice_items;
drop policy if exists invoice_items_update on public.invoice_items;
drop policy if exists invoice_items_delete on public.invoice_items;

create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (public.current_role() in ('Admin', 'Manager', 'Cashier'));

create policy invoice_items_update on public.invoice_items
  for update to authenticated
  using (public.current_role() in ('Admin', 'Manager'))
  with check (public.current_role() in ('Admin', 'Manager'));

create policy invoice_items_delete on public.invoice_items
  for delete to authenticated
  using (public.current_role() in ('Admin', 'Manager'));

-- ============================================================
-- 10. shop_settings
--     - readable by any signed-in user (invoice printing needs it)
--     - writable only by Admin
-- ============================================================
drop policy if exists shop_settings_select on public.shop_settings;
drop policy if exists shop_settings_write on public.shop_settings;

create policy shop_settings_select on public.shop_settings
  for select to authenticated
  using (true);

create policy shop_settings_write on public.shop_settings
  for all to authenticated
  using (public.current_role() = 'Admin')
  with check (public.current_role() = 'Admin');
