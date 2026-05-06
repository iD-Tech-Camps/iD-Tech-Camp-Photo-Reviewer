-- Step 5.8 — Senior routing rules
-- Read by the application on flag insert to decide which senior(s) get pinged.
-- tag_triggers is a text[] of tags.id values; the rule fires when the flag's
-- review_tags intersect tag_triggers (intersection logic lives in app code).
-- Channel delivery (email, slack, etc.) is also app-layer; this table just
-- captures intent.

create table public.senior_routing_rules (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  recipient_id  uuid not null references public.profiles(id) on delete restrict,
  tag_triggers  text[] not null,
  channels      text[] not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),

  -- Channels are an open-ended set today (email/slack/sms/inapp); validate
  -- that the array isn't empty so an inactive rule has to be flipped via the
  -- 'active' column instead of being silently empty.
  constraint senior_routing_rules_channels_nonempty check (cardinality(channels) > 0),
  constraint senior_routing_rules_triggers_nonempty check (cardinality(tag_triggers) > 0)
);

create index senior_routing_rules_active_idx
  on public.senior_routing_rules (active)
  where active = true;
