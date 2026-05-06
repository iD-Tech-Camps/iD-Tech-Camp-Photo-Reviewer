-- Step 7.6c — Promote AppSettings off localStorage
--
-- Migration 7's app_settings only modeled brand_*. The runtime AppSettings
-- type in components/settings.tsx has grown to include reviewer copy
-- (greeting / subtitle / completion / empty-queue), the support email, and
-- the appearance triple (theme / accent / density). Step 7.6c moves all of
-- those off the per-browser localStorage blob and onto the single-row
-- public.app_settings table so every reviewer sees the same admin-curated
-- copy without a cache-prime.
--
-- Out of scope for this migration: bonus_periods (handled by 7.6d in the
-- next migration — it gets its own table since it's a list, not a scalar).
--
-- Hygiene: drop show_leaderboard. It was added in migration 7 but the V1
-- scope refactor (PROJECT_CONTEXT.md "Decisions already made") removed the
-- corresponding feature toggles from the AppSettings type and from every
-- consumer. Nothing reads the column today.

alter table public.app_settings
  drop column if exists show_leaderboard;

alter table public.app_settings
  add column if not exists home_greeting        text,
  add column if not exists home_subtitle        text,
  add column if not exists completion_title     text,
  add column if not exists completion_message   text,
  add column if not exists empty_queue_message  text,
  add column if not exists support_email        text,
  add column if not exists theme                text,
  add column if not exists accent               text,
  add column if not exists density              text;

-- Backfill the singleton row with the DEFAULT_SETTINGS values from
-- components/settings.tsx. Only writes columns that are NULL so a
-- re-run won't clobber admin-curated copy.
update public.app_settings
  set home_greeting       = coalesce(home_greeting,       'Ready when you are, {name}.'),
      home_subtitle       = coalesce(home_subtitle,       'A fresh batch of {count} photos is waiting.'),
      completion_title    = coalesce(completion_title,    'Batch complete.'),
      completion_message  = coalesce(completion_message,  'Nice work. The next batch will be ready shortly.'),
      empty_queue_message = coalesce(empty_queue_message, 'No photos waiting right now. Check back soon.'),
      support_email       = coalesce(support_email,       'support@idtech.com'),
      theme               = coalesce(theme,               'light'),
      accent              = coalesce(accent,              'sun'),
      density             = coalesce(density,             'comfortable'),
      updated_at          = now()
  where id = 1;

-- After the backfill, lock the new columns NOT NULL so the app can rely
-- on them. The brand_* columns are intentionally left nullable — the
-- legacy migration 7 didn't constrain them and changing nullability now
-- would require coordinating with whatever's already in the row.
alter table public.app_settings
  alter column home_greeting       set not null,
  alter column home_subtitle       set not null,
  alter column completion_title    set not null,
  alter column completion_message  set not null,
  alter column empty_queue_message set not null,
  alter column support_email       set not null,
  alter column theme               set not null,
  alter column accent              set not null,
  alter column density             set not null;

-- Constrain the appearance triple. Done as named check constraints rather
-- than enums because the value set is small and unlikely to need cross-
-- table reuse, and dropping/adding a check is cheaper than altering an
-- enum if the UI ever adds a new theme.
alter table public.app_settings
  add constraint app_settings_theme_chk
    check (theme in ('light', 'dark')),
  add constraint app_settings_accent_chk
    check (accent in ('sun', 'lake', 'moss', 'rose')),
  add constraint app_settings_density_chk
    check (density in ('comfortable', 'compact'));
