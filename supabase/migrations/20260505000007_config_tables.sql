-- Step 5.7 — Configuration tables
-- points_config and app_settings are single-row tables enforced via a
-- check (id = 1) constraint. examples is a small admin-managed library.
-- All three are seeded from current values in components/data.tsx and
-- components/settings.tsx.

create table public.points_config (
  id              smallint primary key default 1,
  approve_points  int not null default 10,
  flag_points     int not null default 15,
  delete_points   int not null default 0,
  updated_at      timestamptz not null default now(),

  constraint points_config_singleton check (id = 1)
);

insert into public.points_config (id, approve_points, flag_points, delete_points)
values (1, 10, 15, 0);

create table public.app_settings (
  id                smallint primary key default 1,
  brand_mark        text,
  brand_name        text,
  brand_tagline     text,
  show_leaderboard  boolean not null default true,
  updated_at        timestamptz not null default now(),

  constraint app_settings_singleton check (id = 1)
);

-- Seeded from DEFAULT_SETTINGS in components/settings.tsx.
insert into public.app_settings (id, brand_mark, brand_name, brand_tagline, show_leaderboard)
values (1, 'Ƭ', 'Treeline', 'Photo Review · iD Tech', true);

create table public.examples (
  id             uuid primary key default gen_random_uuid(),
  kind           example_kind not null,
  label          text not null,
  note           text,
  image_url      text,
  display_order  int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Seeded from EXAMPLES.good in components/data.tsx.
insert into public.examples (kind, label, note, display_order) values
  ('good', 'Eye contact, engaged', 'Subjects looking at camera or clearly focused on activity.', 1),
  ('good', 'Hero shot',            'Clear subject, good framing, strong moment.',                 2),
  ('good', 'Group energy',         'Natural group interaction, multiple faces visible.',          3),
  ('good', 'Activity context',     'Shows what camp is actually about. Backdrop reads.',          4);

-- Seeded from EXAMPLES.bad in components/data.tsx.
insert into public.examples (kind, label, note, display_order) values
  ('bad', 'Blurry',                'Motion or focus blur that obscures faces.',               1),
  ('bad', 'Bad expression',        'Mid-blink, mid-chew, or uncomfortable looking.',          2),
  ('bad', 'Messy setup',           'Distracting clutter, trash, disorganized space.',         3),
  ('bad', 'Bad lighting',          'Harsh shadows, blown highlights, or too dark.',           4),
  ('bad', 'Inappropriate gesture', 'Any gesture or pose that shouldn''t go to parents.',      5);
