-- Step 7.6b — Examples library: DB-backed + Supabase Storage uploads
--
-- The original `examples` table (migration 7) was conceptual placeholders:
-- 9 seeded rows with labels but no actual image files. The follow-up
-- decision was to make every example a real uploaded image, with admins
-- managing the library through the AdminExamples screen. This migration:
--
--   1. Adds `storage_path` to `public.examples` so each row can point at
--      its object in the new `example-images` bucket. Nullable for now —
--      the seed rows that get dropped below were the only rows lacking a
--      storage_path; every new row will have one. Leaving the column
--      nullable lets the app fall back to `image_url` if anyone seeds rows
--      directly via SQL in the future, without forcing a NOT NULL backfill.
--
--   2. Deletes the seed rows. There's no migration path that's worth the
--      complexity — admins re-upload real images via the UI. The rows are
--      placeholder labels with no file artifacts, so there's nothing to
--      preserve.
--
--   3. Creates the `example-images` storage bucket (public read, so the
--      Guide screen can load images via the plain public URL without
--      signing). Auth-gated select on the bucket isn't needed: the app's
--      middleware already requires sign-in to reach any screen that would
--      surface these images.
--
--   4. Adds RLS policies on storage.objects scoped to this bucket:
--      - SELECT: any authenticated user (mirrors the bucket-level public
--        read; this policy is what authenticated *clients* hit before the
--        public-read kicks in).
--      - INSERT / UPDATE / DELETE: admin only via the existing
--        public.is_admin() helper.
--
--   5. Adds an RPC `public.reorder_examples(kind, ordered_ids)` that
--      writes display_order for each id in a single transaction. Doing
--      this client-side via N parallel UPDATEs would leave the list in a
--      half-reordered state if any one failed; a server-side function in
--      a single statement avoids that.

-- ─── 1. New column on public.examples ────────────────────────────────────

alter table public.examples
  add column if not exists storage_path text;

-- ─── 2. Drop placeholder seed rows ────────────────────────────────────────

delete from public.examples;

-- ─── 3. Storage bucket ────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('example-images', 'example-images', true)
on conflict (id) do nothing;

-- ─── 4. Storage RLS — separate from table RLS, both must be set ───────────
--
-- These policies live on storage.objects (the per-file row table), filtered
-- to bucket_id = 'example-images'. Drop-then-create makes the migration
-- safe to re-run.

drop policy if exists example_images_select_authenticated on storage.objects;
drop policy if exists example_images_insert_admin         on storage.objects;
drop policy if exists example_images_update_admin         on storage.objects;
drop policy if exists example_images_delete_admin         on storage.objects;

create policy example_images_select_authenticated
  on storage.objects for select
  to authenticated
  using (bucket_id = 'example-images');

create policy example_images_insert_admin
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'example-images' and public.is_admin());

create policy example_images_update_admin
  on storage.objects for update
  to authenticated
  using  (bucket_id = 'example-images' and public.is_admin())
  with check (bucket_id = 'example-images' and public.is_admin());

create policy example_images_delete_admin
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'example-images' and public.is_admin());

-- ─── 5. Reorder RPC ───────────────────────────────────────────────────────
--
-- Takes the new ordering as an array of ids, scoped to a kind, and writes
-- display_order = position-in-array. Wrapped in a function so the whole
-- update is one statement (atomic) and admins don't have to fire one
-- UPDATE per row from the client.
--
-- Restricted to the same audience the table's write policy admits — admin
-- only — by re-checking is_admin() inside the function. The function runs
-- security definer so it can perform the bulk update through the table's
-- RLS layer cleanly without re-evaluating per-row auth.

create or replace function public.reorder_examples(
  p_kind        example_kind,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'reorder_examples requires admin role';
  end if;

  -- Use unnest with ordinality to get the new display_order for each id.
  -- The kind filter is a defensive guard so a caller can't accidentally
  -- shuffle rows of the wrong kind even if they pass mixed ids.
  update public.examples e
     set display_order = sub.new_order
    from (
      select id, ordinality::int as new_order
        from unnest(p_ordered_ids) with ordinality as t(id, ordinality)
    ) as sub
   where e.id = sub.id
     and e.kind = p_kind;
end;
$$;

revoke all on function public.reorder_examples(example_kind, uuid[]) from public;
grant execute on function public.reorder_examples(example_kind, uuid[]) to authenticated;
