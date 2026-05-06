-- Step 5.1 — Enums
-- The six enums that the rest of the schema depends on. Defined first so
-- every subsequent migration can reference them without forward declarations.

create type decision       as enum ('approve', 'flag', 'delete');
create type role           as enum ('reviewer', 'senior', 'admin');
create type profile_status as enum ('active', 'idle', 'inactive');
create type tag_kind       as enum ('positive', 'negative');
create type photo_status   as enum ('pending', 'approved', 'flagged', 'deleted');
create type example_kind   as enum ('good', 'bad');
