-- Step 5.2 — Profiles + auto-create trigger
-- One profile per auth.users row. A trigger on auth.users handles creation
-- so the app never needs to manually insert into profiles. Default role is
-- 'reviewer'; admins promote people via UPDATE later.

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null,
  full_name       text,
  role            role not null default 'reviewer',
  team            text,
  status          profile_status not null default 'active',
  created_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now()
);

-- Standard Supabase pattern: pull id, email, and full_name from raw metadata
-- on every new auth.users row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
