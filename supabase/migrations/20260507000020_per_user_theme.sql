-- Step 7.7c — Theme moves off app_settings (global) to profiles (per-user).
--
-- Why: theme is a personal preference; one reviewer's dark mode shouldn't
-- override another's light mode just because they share a singleton config
-- row. Density gets dropped entirely — it was never wired to any DOM hook
-- or CSS rule (no `data-density` attribute, no compact branch in legacy.css)
-- and adding it well isn't worth the work for an internal tool. Accent
-- stays on app_settings — it's the brand color (lives in the Branding card
-- on Admin → Settings now).
--
-- Single column on profiles is fine for V1; if more per-user prefs accrue
-- later (notifications opt-out, density-after-all, etc.) spin up a
-- dedicated `user_preferences` table at that point.
--
-- RLS: the existing `profiles_update_self` policy from migration 9
-- with-checks `role` and `team` only — adding a new column means a user
-- can update their own theme without any extra policy work.

alter table public.profiles
  add column if not exists theme text not null default 'light';

alter table public.profiles
  add constraint profiles_theme_chk
    check (theme in ('light', 'dark'));

-- Drop the now-unused columns from app_settings. The named CHECKs
-- migration 16 added go with them.
alter table public.app_settings
  drop constraint if exists app_settings_theme_chk,
  drop constraint if exists app_settings_density_chk;

alter table public.app_settings
  drop column if exists theme,
  drop column if exists density;
