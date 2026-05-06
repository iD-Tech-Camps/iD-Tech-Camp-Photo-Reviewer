import type { SupabaseClient } from "@supabase/supabase-js";

// Tag as the app needs it — camel-cased projection of the `tags` table.
// `kind = 'positive'` is for approves, `kind = 'negative'` is for flags.
// See migration 4 for the seed (13 negatives + 4 positives, ids verbatim
// from components/data.tsx so existing review_tags rows stay valid).
export type Tag = {
  id: string;
  label: string;
  kind: "positive" | "negative";
  displayOrder: number;
  active: boolean;
};

type RawTagRow = {
  id: string;
  label: string;
  kind: "positive" | "negative";
  display_order: number;
  active: boolean;
};

const TAG_COLUMNS = "id, label, kind, display_order, active";

function mapRow(r: RawTagRow): Tag {
  return {
    id:           r.id,
    label:        r.label,
    kind:         r.kind,
    displayOrder: r.display_order,
    active:       r.active,
  };
}

// Pulls every tag, ordered by (kind, display_order, label) so the UI gets a
// stable sort regardless of the DB's physical row order. Includes inactive
// tags — callers filter on `active` when displaying to reviewers but the
// admin TagLibrary needs the full list to manage them.
export async function fetchTags(supabase: SupabaseClient): Promise<Tag[]> {
  const { data, error } = await supabase
    .from("tags")
    .select(TAG_COLUMNS)
    .order("kind",          { ascending: true })
    .order("display_order", { ascending: true })
    .order("label",         { ascending: true });

  if (error) throw error;
  return ((data ?? []) as unknown as RawTagRow[]).map(mapRow);
}

// Convenience: split the active tags into the two lists the review modals
// consume. Inactive tags are excluded — they shouldn't appear to reviewers
// even if a previous decision still references them via review_tags.
export function partitionActiveTags(tags: Tag[]): {
  positives: Tag[];
  negatives: Tag[];
} {
  const positives: Tag[] = [];
  const negatives: Tag[] = [];
  for (const t of tags) {
    if (!t.active) continue;
    if (t.kind === "positive") positives.push(t);
    else negatives.push(t);
  }
  return { positives, negatives };
}

// Returns a label for any tag id we might encounter — including inactive
// tags (so historical flag rows still render their reason chips correctly)
// and unknown ids (we fall back to the id itself, same behavior the old
// `negativeTagLabel` helper had).
export function buildTagLabelLookup(tags: Tag[]): (id: string) => string {
  const map = new Map(tags.map((t) => [t.id, t.label]));
  return (id) => map.get(id) ?? id;
}

// ─── admin write helpers ────────────────────────────────────────────────────
// All writes go through RLS policy `tags_write_admin` (migration 9), which
// requires `is_admin()` to return true. The browser client uses the user's
// JWT, so non-admin callers will be rejected by the DB — no need to guard
// in app code beyond the obvious "don't render the admin UI for non-admins"
// gate the sidebar already enforces.

export type CreateTagInput = {
  id: string;
  label: string;
  kind: "positive" | "negative";
  displayOrder?: number;
};

export async function createTag(
  supabase: SupabaseClient,
  input: CreateTagInput,
): Promise<Tag> {
  const { data, error } = await supabase
    .from("tags")
    .insert({
      id:            input.id,
      label:         input.label,
      kind:          input.kind,
      display_order: input.displayOrder ?? 0,
    })
    .select(TAG_COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error("tags insert returned no row");
  return mapRow(data as unknown as RawTagRow);
}

export async function setTagActive(
  supabase: SupabaseClient,
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("tags")
    .update({ active })
    .eq("id", id);
  if (error) throw error;
}

// True delete (not soft). Hard deletes are FK-restricted by `review_tags`
// (the join table sets `on delete restrict` on tag_id), so this will fail
// if the tag has ever been used. The admin UI catches that and offers the
// soft-delete path (setTagActive(false)) instead.
export async function deleteTag(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from("tags")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Slug-style id from a free-text label. Mirrors the convention used by the
// migration-4 seed so admin-created tags blend in with the originals.
// Examples:
//   "Hero shot"   → "hero-shot"
//   "  off-brand" → "off-brand"
//   "🚩 issue!"   → "issue"
export function slugifyTagId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
