-- Step 7.7a — Admin-uploaded favicon
--
-- The favicon used to be a static asset shipped with the app. Step 7.7a
-- promotes it to admin-managed branding: the admin uploads a PNG via the
-- Admin → Settings screen, the file lands in the `branding-assets` storage
-- bucket, and `app_settings.favicon_storage_path` records the object path.
-- `app/layout.tsx` reads the path during `generateMetadata` and emits the
-- corresponding `<link rel="icon">`. When the column is NULL we emit no
-- icon link and the browser shows its generic fallback.
--
-- The same `branding-assets` bucket is set up to host any future single-
-- artifact brand uploads (header logo, login splash, etc.). It mirrors the
-- pattern migration 18 used for `example-images`: public-read so the
-- browser can load assets without signing, admin-write enforced by both a
-- bucket-level convention and an explicit policy on `storage.objects`.

-- ─── 1. New column on public.app_settings ────────────────────────────────────
--
-- Nullable on purpose: NULL means "no favicon configured, render none". The
-- runtime expects this and falls back to no <link rel="icon"> at all rather
-- than coercing to a default asset.

alter table public.app_settings
  add column if not exists favicon_storage_path text;

-- ─── 2. Storage bucket ───────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('branding-assets', 'branding-assets', true)
on conflict (id) do nothing;

-- ─── 3. Storage RLS — separate from table RLS, both must be set ──────────────
--
-- These policies live on storage.objects (the per-file row table), filtered
-- to bucket_id = 'branding-assets'. Drop-then-create makes the migration
-- safe to re-run.

drop policy if exists branding_assets_select_authenticated on storage.objects;
drop policy if exists branding_assets_insert_admin         on storage.objects;
drop policy if exists branding_assets_update_admin         on storage.objects;
drop policy if exists branding_assets_delete_admin         on storage.objects;

create policy branding_assets_select_authenticated
  on storage.objects for select
  to authenticated
  using (bucket_id = 'branding-assets');

create policy branding_assets_insert_admin
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'branding-assets' and public.is_admin());

create policy branding_assets_update_admin
  on storage.objects for update
  to authenticated
  using  (bucket_id = 'branding-assets' and public.is_admin())
  with check (bucket_id = 'branding-assets' and public.is_admin());

create policy branding_assets_delete_admin
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'branding-assets' and public.is_admin());
