-- Step 5.4 — Tags + seed
-- Slug ids are hand-curated and intentionally stable: review_tags references
-- them by id, so renaming a label later is a pure-display change. Seed values
-- come from components/data.tsx — NEGATIVE_TAGS verbatim and the four
-- non-rose entries from PHOTO_TAGS as positives.

create table public.tags (
  id             text primary key,
  label          text not null,
  kind           tag_kind not null,
  display_order  int not null default 0,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Negative tags (used on flag decisions). Order matches NEGATIVE_TAGS in data.tsx.
insert into public.tags (id, label, kind, display_order) values
  ('blurry',         'Blurry / out of focus',                'negative',  1),
  ('bad-expression', 'Bad expression',                       'negative',  2),
  ('bad-lighting',   'Bad lighting',                         'negative',  3),
  ('messy-setup',    'Messy background',                     'negative',  4),
  ('no-faces',       'No faces / camper not visible',        'negative',  5),
  ('duplicate',      'Duplicate shot',                       'negative',  6),
  ('off-brand',      'Off-brand / not camp context',         'negative',  7),
  ('low-quality',    'Technical issue (resolution, crop)',   'negative',  8),
  ('inappropriate',  'Possibly inappropriate',               'negative',  9),
  ('gesture',        'Questionable gesture',                 'negative', 10),
  ('consent',        'Consent / media release unclear',      'negative', 11),
  ('minor-ident',    'Identifying info visible',             'negative', 12),
  ('safety',         'Safety concern',                       'negative', 13);

-- Positive tags (used on approve decisions). Source: PHOTO_TAGS in data.tsx,
-- filtered to color != 'rose' (the same filter ReviewScreen does locally).
insert into public.tags (id, label, kind, display_order) values
  ('great-moment',   'Great moment',    'positive', 1),
  ('hero-shot',      'Hero shot',       'positive', 2),
  ('group-energy',   'Group energy',    'positive', 3),
  ('caption-worthy', 'Caption-worthy',  'positive', 4);
