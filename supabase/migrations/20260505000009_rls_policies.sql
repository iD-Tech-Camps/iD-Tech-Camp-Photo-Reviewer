-- Step 5.9 — Row-Level Security
-- Enable RLS on every public table created in steps 5.2–5.8 and define the
-- policies described in the spec's RLS outline. Default deny is the natural
-- consequence of enabling RLS without a matching policy.
--
-- Two helper functions read the caller's role from profiles. They are marked
-- SECURITY DEFINER so they don't trip the very policy they're being used to
-- evaluate. Their search_path is pinned to public to avoid hijacking.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_senior_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role in ('senior', 'admin')
  );
$$;

revoke all on function public.is_admin()           from public;
revoke all on function public.is_senior_or_admin() from public;
grant execute on function public.is_admin()           to authenticated;
grant execute on function public.is_senior_or_admin() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

create policy profiles_select_authenticated
  on public.profiles for select
  to authenticated
  using (true);

-- Users can update their own row, but role and team are admin-only. We
-- enforce that by splitting into two policies: a self-update that excludes
-- those columns by checking nothing changed, and an admin-update that's
-- unrestricted. Postgres evaluates UPDATE policies as "any policy passes",
-- so admins still match the broader policy.
create policy profiles_update_self
  on public.profiles for update
  to authenticated
  using  (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select role from public.profiles where id = auth.uid())
    and team is not distinct from (select team from public.profiles where id = auth.uid())
  );

create policy profiles_update_admin
  on public.profiles for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

create policy profiles_insert_admin
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

create policy profiles_delete_admin
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- divisions / locations / camp_weeks / photos
-- Read-only for the app; writes happen via the SmugMug import job using the
-- service role, which bypasses RLS by design.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.divisions  enable row level security;
alter table public.locations  enable row level security;
alter table public.camp_weeks enable row level security;
alter table public.photos     enable row level security;

create policy divisions_select_authenticated
  on public.divisions for select to authenticated using (true);

create policy locations_select_authenticated
  on public.locations for select to authenticated using (true);

create policy camp_weeks_select_authenticated
  on public.camp_weeks for select to authenticated using (true);

create policy photos_select_authenticated
  on public.photos for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- tags / examples / senior_routing_rules / points_config / app_settings
-- Read by everyone, writes are admin-only.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.tags                 enable row level security;
alter table public.examples             enable row level security;
alter table public.senior_routing_rules enable row level security;
alter table public.points_config        enable row level security;
alter table public.app_settings         enable row level security;

create policy tags_select_authenticated
  on public.tags for select to authenticated using (true);
create policy tags_write_admin
  on public.tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy examples_select_authenticated
  on public.examples for select to authenticated using (true);
create policy examples_write_admin
  on public.examples for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy routing_rules_select_authenticated
  on public.senior_routing_rules for select to authenticated using (true);
create policy routing_rules_write_admin
  on public.senior_routing_rules for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy points_config_select_authenticated
  on public.points_config for select to authenticated using (true);
create policy points_config_write_admin
  on public.points_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy app_settings_select_authenticated
  on public.app_settings for select to authenticated using (true);
create policy app_settings_write_admin
  on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- reviews
-- The interesting one. Insert is split by decision so seniors/admins are the
-- only ones who can write a 'delete' review. reviewer_id must equal auth.uid()
-- to prevent impersonation. Updates and deletes are blocked entirely — the log
-- is immutable; mistakes are corrected by writing a new review.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.reviews enable row level security;

create policy reviews_select_authenticated
  on public.reviews for select to authenticated using (true);

create policy reviews_insert_self_approve_or_flag
  on public.reviews for insert
  to authenticated
  with check (
    reviewer_id = auth.uid()
    and decision in ('approve', 'flag')
  );

create policy reviews_insert_senior_delete
  on public.reviews for insert
  to authenticated
  with check (
    reviewer_id = auth.uid()
    and decision = 'delete'
    and public.is_senior_or_admin()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- review_tags
-- Same shape as reviews: anyone can read; insert is allowed only when the
-- caller owns the parent review. No update/delete (cascade-on-review-delete
-- is the only path, but reviews can't be deleted either, so this is moot
-- in practice).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.review_tags enable row level security;

create policy review_tags_select_authenticated
  on public.review_tags for select to authenticated using (true);

create policy review_tags_insert_owner
  on public.review_tags for insert
  to authenticated
  with check (
    exists (
      select 1 from public.reviews r
       where r.id = review_id
         and r.reviewer_id = auth.uid()
    )
  );
