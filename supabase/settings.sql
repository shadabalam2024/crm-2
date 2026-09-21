-- Settings page support: storage bucket for shop assets (logo).
--
-- Run this in the Supabase SQL editor (or `supabase db push` if you adopt migrations).
-- shop_settings / permissions / profiles RLS already lives in rls_policies.sql and is
-- NOT redefined here - this file only adds what the Settings page's Shop Info tab
-- needs for logo uploads, reusing public.current_role() from rls_policies.sql.
--
-- Safe to re-run: bucket insert is idempotent and policies are dropped/recreated.

-- ============================================================
-- 1. Storage bucket for shop assets (logo image)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('shop-assets', 'shop-assets', true)
on conflict (id) do nothing;

-- ============================================================
-- 2. RLS policies on storage.objects, scoped to this bucket
--    - anyone (incl. anonymous, e.g. the standalone invoice-print
--      window) can read, since the logo is shown on printed
--      invoices and the bucket is public
--    - only Admin can upload/replace/delete, mirroring
--      shop_settings_write in rls_policies.sql
-- ============================================================
drop policy if exists shop_assets_select on storage.objects;
drop policy if exists shop_assets_insert on storage.objects;
drop policy if exists shop_assets_update on storage.objects;
drop policy if exists shop_assets_delete on storage.objects;

create policy shop_assets_select on storage.objects
  for select to public
  using (bucket_id = 'shop-assets');

create policy shop_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'shop-assets' and public.current_role() = 'Admin');

create policy shop_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'shop-assets' and public.current_role() = 'Admin')
  with check (bucket_id = 'shop-assets' and public.current_role() = 'Admin');

create policy shop_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'shop-assets' and public.current_role() = 'Admin');
