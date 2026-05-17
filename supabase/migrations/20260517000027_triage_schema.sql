-- Migration 27 — Triage schema (enums, columns, tables, indexes, tag seed).
-- Triggers, RLS, and backfill land in migration 28.
-- See spec/TRIAGE_SPEC.md §3 and §8.

-- ─── 1. Enums (§3a) ─────────────────────────────────────────────────────────

create type public.camp_week_triage_role as enum (
  'none', 'first_week', 'second_week_recheck'
);

create type public.camp_week_triage_state as enum (
  'not_required', 'awaiting_photos', 'photos_in',
  'triage_in_progress', 'triage_done', 'senior_review', 'complete'
);

create type public.photo_triage_state as enum (
  'not_required', 'pending', 'in_progress', 'clean', 'flagged', 'deleted'
);

create type public.triage_event_kind as enum (
  'clean', 'flag',
  'senior_delete', 'senior_quarantine', 'senior_release_quarantine'
);

create type public.claim_release_reason as enum (
  'explicit', 'auto_expired', 'week_complete', 'admin_force'
);

create type public.tag_category as enum (
  'quality', 'setup', 'brand', 'safety', 'general'
);

-- ─── 2. tags.category (§3b, §10) ───────────────────────────────────────────

alter table public.tags
  add column category public.tag_category not null default 'general';

-- ─── 2b. Tag seed (§3f) — before triage_event_tags FK exists ────────────────

delete from public.tags;

insert into public.tags (id, label, display_order, active, category) values
  ('blurry-photos',              'Blurry Photos',              1,  true, 'quality'),
  ('duplicate-photos',           'Duplicate Photos',           2,  true, 'quality'),
  ('low-lighting',               'Low Lighting',               3,  true, 'quality'),
  ('lacking-variety',            'Lacking Variety',            4,  true, 'quality'),
  ('water-bottles-by-laptops',   'Water Bottles by Laptops',   5,  true, 'setup'),
  ('students-without-lanyards',  'Students w/o Lanyards',      6,  true, 'safety'),
  ('decals-falling-off',         'Decals Falling Off',         7,  true, 'brand'),
  ('decals-bubbling',            'Decals Bubbling',            8,  true, 'brand'),
  ('decals-cluttered',           'Decals Cluttered',           9,  true, 'brand'),
  ('bb-arena-missing-decals',    'BB Arena Missing Decals',    10, true, 'brand'),
  ('visible-boxes',              'Visible Boxes',              11, true, 'setup'),
  ('messy-lab',                  'Messy Lab',                  12, true, 'setup');

-- ─── 3. Alter existing tables (defer photos.triage_claim_id) ────────────────

alter table public.camp_weeks
  add column triage_role public.camp_week_triage_role not null default 'none',
  add column triage_state public.camp_week_triage_state not null default 'not_required',
  add column is_first_week_override boolean,
  add column triage_started_at timestamptz,
  add column triage_done_at timestamptz,
  add column senior_review_started_at timestamptz,
  add column signoff_at timestamptz,
  add column signoff_by uuid references public.profiles(id) on delete set null,
  add column recheck_flagged_at timestamptz,
  add column recheck_flagged_by uuid references public.profiles(id) on delete set null,
  add column positive_great_quality boolean not null default false,
  add column positive_great_variety boolean not null default false,
  add column positive_shininess_great boolean not null default false;

alter table public.locations
  add column evergreen_notes text;

alter table public.photos
  add column triage_state public.photo_triage_state not null default 'not_required',
  add column sampled_for_burst boolean not null default false;

-- camp_weeks_with_status is SELECT * FROM camp_weeks — new columns appear
-- automatically; no view recreation required.

-- ─── 4. triage_config singleton + seed (§3c) ────────────────────────────────

create table public.triage_config (
  id                         smallint primary key default 1 check (id = 1),
  first_week_window_start    date not null,
  first_week_window_end      date not null,
  max_for_triage_per_burst   int not null default 200 check (max_for_triage_per_burst > 0),
  sample_burst_dow           smallint not null default 2 check (sample_burst_dow between 0 and 6),
  sample_burst_hour          smallint not null default 19 check (sample_burst_hour between 0 and 23),
  claim_expiry_minutes       int not null default 60 check (claim_expiry_minutes > 0),
  updated_at                 timestamptz not null default now(),
  check (first_week_window_end >= first_week_window_start)
);

insert into public.triage_config (
  id, first_week_window_start, first_week_window_end,
  sample_burst_dow, sample_burst_hour
) values (
  1, date '2026-05-24', date '2026-08-09', 2, 19
);

-- ─── 5. New tables (§3c) ────────────────────────────────────────────────────

create table public.triage_claims (
  id                  uuid primary key default gen_random_uuid(),
  camp_week_id        uuid not null references public.camp_weeks(id) on delete cascade,
  reviewer_id         uuid not null references public.profiles(id) on delete cascade,
  slice_size          int not null check (slice_size > 0),
  claimed_at          timestamptz not null default now(),
  last_activity_at    timestamptz not null default now(),
  released_at         timestamptz,
  release_reason      public.claim_release_reason,
  check ((released_at is null) = (release_reason is null))
);

create index triage_claims_active_per_week_idx
  on public.triage_claims (camp_week_id) where released_at is null;

create index triage_claims_active_per_reviewer_idx
  on public.triage_claims (reviewer_id) where released_at is null;

create index triage_claims_sweeper_idx
  on public.triage_claims (last_activity_at) where released_at is null;

create table public.triage_events (
  id                uuid primary key default gen_random_uuid(),
  photo_id          uuid not null references public.photos(id) on delete cascade,
  reviewer_id       uuid not null references public.profiles(id) on delete restrict,
  claim_id          uuid references public.triage_claims(id) on delete set null,
  kind              public.triage_event_kind not null,
  quarantine_intent boolean not null default false,
  note              text,
  created_at        timestamptz not null default now(),
  check (
    case kind
      when 'flag' then true
      when 'clean' then quarantine_intent = false
      else quarantine_intent = false
    end
  )
);

create index triage_events_per_reviewer_idx
  on public.triage_events (reviewer_id, created_at desc);

create index triage_events_per_photo_idx
  on public.triage_events (photo_id, created_at desc);

create table public.triage_event_tags (
  event_id uuid not null references public.triage_events(id) on delete cascade,
  tag_id   text not null references public.tags(id) on delete restrict,
  primary key (event_id, tag_id)
);

-- ─── 6. photos.triage_claim_id FK ───────────────────────────────────────────

alter table public.photos
  add column triage_claim_id uuid references public.triage_claims(id) on delete set null;

-- ─── 7. Indexes (§3d) ───────────────────────────────────────────────────────

create index camp_weeks_triage_hub_idx
  on public.camp_weeks (triage_state, triage_role)
  where triage_state <> 'not_required' and triage_state <> 'complete';

create index camp_weeks_awaiting_signoff_idx
  on public.camp_weeks (signoff_at)
  where triage_state in ('triage_done', 'senior_review');

create index photos_triage_grid_idx
  on public.photos (camp_week_id, triage_state);

create index photos_triage_pending_pool_idx
  on public.photos (camp_week_id, sampled_for_burst desc, captured_at)
  where triage_state = 'pending';

create index photos_triage_claim_idx
  on public.photos (triage_claim_id)
  where triage_claim_id is not null;

-- Legacy name from migration 05; spec §3d calls this photos_is_quarantined_idx.
create index if not exists photos_is_quarantined_idx
  on public.photos (is_quarantined)
  where is_quarantined = true;
