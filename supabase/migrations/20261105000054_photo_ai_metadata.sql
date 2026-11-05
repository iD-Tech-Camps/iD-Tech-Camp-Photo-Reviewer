-- AI search metadata for photos.
--
-- Gemini Flash describes each photo (caption, people/gender counts, activities,
-- technology, keywords, ...). We store that structured metadata plus two
-- embeddings so photos can be found by natural-language search without anyone
-- re-reading the images:
--   text_embedding  — embedding of the metadata "search document"
--   image_embedding — embedding of the image itself (multimodal model)
--   search_tsv      — full-text index over caption + keywords + tags
-- photo_ai_search() fuses all three (reciprocal rank fusion) under structured
-- filters. Rows are written only by the service role (the tagging sweep).
--
-- One row per photo. status = 'failed' rows record the error and attempt
-- count so the sweep retries a bounded number of times instead of looping.
-- Additive only; safe to apply before or after the code that uses it.

create extension if not exists vector with schema extensions;

-- array_to_string() is only STABLE, which generated columns reject. Joining a
-- text[] with a space is deterministic, so wrap it as IMMUTABLE.
create or replace function public.photo_ai_join_text(arr text[])
returns text
language sql
immutable
parallel safe
as $$ select coalesce(array_to_string(arr, ' '), '') $$;

create table public.photo_ai_metadata (
  photo_id             uuid primary key references public.photos(id) on delete cascade,
  status               text not null default 'done' check (status in ('done', 'failed')),
  attempts             int  not null default 1,
  last_error           text,

  caption              text,
  people_count_bucket  text check (people_count_bucket in ('0', '1', '2', '3-5', '6-15', '16+')),
  -- Apparent gender as judged by the model; for aggregate representation
  -- review and search filters, not a per-person record.
  girls                int,
  boys                 int,
  women                int,
  men                  int,
  gender_unclear       int,
  shot_type            text,
  photo_quality        text check (photo_quality in ('good', 'ok', 'poor')),
  activities           text[] not null default '{}',
  objects              text[] not null default '{}',
  technology           text[] not null default '{}',
  setting              text[] not null default '{}',
  mood                 text[] not null default '{}',
  keywords             text[] not null default '{}',

  text_embedding       extensions.vector(768),
  image_embedding      extensions.vector(768),
  search_tsv           tsvector generated always as (
    to_tsvector(
      'english'::regconfig,
      coalesce(caption, '') || ' ' ||
      public.photo_ai_join_text(activities) || ' ' ||
      public.photo_ai_join_text(objects) || ' ' ||
      public.photo_ai_join_text(technology) || ' ' ||
      public.photo_ai_join_text(setting) || ' ' ||
      public.photo_ai_join_text(mood) || ' ' ||
      public.photo_ai_join_text(keywords)
    )
  ) stored,

  model                text,
  prompt_version       int,
  tagged_at            timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index photo_ai_metadata_failed_idx
  on public.photo_ai_metadata (updated_at)
  where status = 'failed';

create index photo_ai_metadata_tsv_idx
  on public.photo_ai_metadata using gin (search_tsv);

create index photo_ai_metadata_text_emb_idx
  on public.photo_ai_metadata using hnsw (text_embedding extensions.vector_cosine_ops);

create index photo_ai_metadata_image_emb_idx
  on public.photo_ai_metadata using hnsw (image_embedding extensions.vector_cosine_ops);

alter table public.photo_ai_metadata enable row level security;

-- Same visibility as photos (any signed-in user). No write policies: only the
-- service role writes.
create policy photo_ai_metadata_select
  on public.photo_ai_metadata for select to authenticated using (true);


-- ─── Work queue for the tagging sweep ───────────────────────────────────────
-- Photos with no metadata yet, plus failed ones due a retry (max 3 attempts,
-- at least an hour apart). Skips quarantined photos and ignored locations.
-- Newest first so fresh uploads are searchable quickly even mid-backfill.
--
-- SECURITY INVOKER on purpose: Supabase re-grants EXECUTE on public functions
-- to anon/authenticated, so a REVOKE alone doesn't keep them out. As invoker,
-- RLS decides: the service role (the sweep) sees everything, signed-in users
-- see only photos they can already read, and anon sees nothing.

create or replace function public.photo_ai_pending(p_limit int default 50)
returns table (
  photo_id      uuid,
  image_url     text,
  thumbnail_url text,
  attempts      int,
  week_name     text,
  starts_on     date,
  location_name text,
  division_name text
)
language sql
stable
security invoker
set search_path = public
as $$
  select p.id, p.image_url, p.thumbnail_url, coalesce(m.attempts, 0),
         w.name, w.starts_on, l.name, d.name
    from public.photos p
    join public.camp_weeks w on w.id = p.camp_week_id
    join public.locations  l on l.id = w.location_id
    join public.divisions  d on d.id = l.division_id
    left join public.photo_ai_metadata m on m.photo_id = p.id
   where p.is_quarantined = false
     and l.is_ignored = false
     and coalesce(p.image_url, p.thumbnail_url) is not null
     and (
       m.photo_id is null
       or (m.status = 'failed' and m.attempts < 3 and m.updated_at < now() - interval '1 hour')
     )
   order by p.captured_at desc nulls last, p.id
   limit greatest(1, least(p_limit, 500));
$$;

grant execute on function public.photo_ai_pending(int) to service_role;


-- ─── Progress counts (admin overview / backfill monitoring) ─────────────────
-- Invoker for the same reason as photo_ai_pending.

create or replace function public.photo_ai_progress()
returns table (eligible bigint, done bigint, failed bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select count(*),
         count(*) filter (where m.status = 'done'),
         count(*) filter (where m.status = 'failed')
    from public.photos p
    join public.camp_weeks w on w.id = p.camp_week_id
    join public.locations  l on l.id = w.location_id
    left join public.photo_ai_metadata m on m.photo_id = p.id
   where p.is_quarantined = false
     and l.is_ignored = false
     and coalesce(p.image_url, p.thumbnail_url) is not null;
$$;

grant execute on function public.photo_ai_progress() to authenticated, service_role;


-- ─── Hybrid search ──────────────────────────────────────────────────────────
-- Filters first (season/division/location/week, people, shot type, gender
-- minimums, quality), then three rankings over the filtered set:
--   1. text_embedding cosine similarity to the query embedding
--   2. image_embedding cosine similarity to the query embedding
--   3. full-text rank of the query words (OR'd, so partial matches count)
-- fused with reciprocal rank fusion (k = 60). Each ranking contributes its
-- top 200. p_min_similarity drops photos whose best embedding similarity is
-- below the cutoff, so "nothing matches" can come back empty.
--
-- SECURITY INVOKER: RLS on photos / photo_ai_metadata applies to the caller.

create or replace function public.photo_ai_search(
  p_embedding        text,               -- '[0.1,0.2,...]' (768 dims)
  p_query            text default '',
  p_limit            int  default 24,
  p_season           int  default null,
  p_division_id      uuid default null,
  p_location_id      uuid default null,
  p_camp_week_id     uuid default null,
  p_people           text[] default null, -- people_count_bucket values
  p_shot_types       text[] default null,
  p_min_girls        int  default null,
  p_min_boys         int  default null,
  p_min_women        int  default null,
  p_min_men          int  default null,
  p_include_poor     boolean default false,
  p_min_similarity   real default null
)
returns table (
  photo_id          uuid,
  score             double precision,
  text_similarity   double precision,
  image_similarity  double precision,
  keyword_match     boolean,
  caption           text,
  thumbnail_url     text,
  image_url         text,
  smugmug_url       text,
  captured_at       timestamptz,
  camp_week_id      uuid,
  week_name         text,
  starts_on         date,
  location_name     text,
  division_name     text,
  people_count_bucket text,
  girls int, boys int, women int, men int, gender_unclear int,
  shot_type         text,
  technology        text[],
  keywords          text[]
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with q as (
    select p_embedding::extensions.vector(768) as emb,
           nullif(replace(plainto_tsquery('english', coalesce(p_query, ''))::text, '&', '|'), '')::tsquery as tsq
  ),
  base as (
    select m.*, p.thumbnail_url as p_thumb, p.image_url as p_image, p.smugmug_url as p_smug,
           p.captured_at as p_captured, w.id as w_id, w.name as w_name, w.starts_on as w_starts,
           l.name as l_name, d.name as d_name
      from public.photo_ai_metadata m
      join public.photos p     on p.id = m.photo_id
      join public.camp_weeks w on w.id = p.camp_week_id
      join public.locations l  on l.id = w.location_id
      join public.divisions d  on d.id = l.division_id
     where m.status = 'done'
       and p.is_quarantined = false
       and l.is_ignored = false
       and (p_season is null or w.starts_on between make_date(p_season, 1, 1) and make_date(p_season, 12, 31))
       and (p_division_id  is null or l.division_id = p_division_id)
       and (p_location_id  is null or w.location_id = p_location_id)
       and (p_camp_week_id is null or w.id = p_camp_week_id)
       and (p_people is null or m.people_count_bucket = any(p_people))
       and (p_shot_types is null or m.shot_type = any(p_shot_types))
       and (p_min_girls is null or m.girls >= p_min_girls)
       and (p_min_boys  is null or m.boys  >= p_min_boys)
       and (p_min_women is null or m.women >= p_min_women)
       and (p_min_men   is null or m.men   >= p_min_men)
       and (p_include_poor or m.photo_quality is distinct from 'poor')
  ),
  sims as (
    select b.photo_id,
           1 - (b.text_embedding  <=> q.emb) as tsim,
           1 - (b.image_embedding <=> q.emb) as isim,
           (q.tsq is not null and b.search_tsv @@ q.tsq) as kw,
           case when q.tsq is not null then ts_rank_cd(b.search_tsv, q.tsq) else 0 end as kwrank
      from base b, q
  ),
  ranked as (
    select s.*,
           row_number() over (order by s.tsim desc nulls last) as r_text,
           row_number() over (order by s.isim desc nulls last) as r_image,
           case when s.kw then row_number() over (partition by s.kw order by s.kwrank desc) end as r_kw
      from sims s
     where p_min_similarity is null
        or greatest(coalesce(s.tsim, 0), coalesce(s.isim, 0)) >= p_min_similarity
  ),
  fused as (
    select r.*,
           (case when r.r_text  <= 200 and r.tsim is not null then 1.0 / (60 + r.r_text)  else 0 end) +
           (case when r.r_image <= 200 and r.isim is not null then 1.0 / (60 + r.r_image) else 0 end) +
           (case when r.r_kw    <= 200 then 1.0 / (60 + r.r_kw) else 0 end) as fused_score
      from ranked r
  )
  select f.photo_id, f.fused_score, f.tsim, f.isim, f.kw,
         b.caption, b.p_thumb, b.p_image, b.p_smug, b.p_captured,
         b.w_id, b.w_name, b.w_starts, b.l_name, b.d_name,
         b.people_count_bucket, b.girls, b.boys, b.women, b.men, b.gender_unclear,
         b.shot_type, b.technology, b.keywords
    from fused f
    join base b on b.photo_id = f.photo_id
   where f.fused_score > 0
   order by f.fused_score desc, f.photo_id
   limit greatest(1, least(p_limit, 100));
$$;

grant execute on function public.photo_ai_search(
  text, text, int, int, uuid, uuid, uuid, text[], text[], int, int, int, int, boolean, real
) to authenticated, service_role;
