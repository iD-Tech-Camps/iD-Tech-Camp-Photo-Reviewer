import type { SupabaseClient } from "@supabase/supabase-js";

export type TagCategory = "quality" | "setup" | "brand" | "safety" | "general";

export type TagPurpose = "quality_flag" | "photo_rating" | "week_senior";

export type TagValence = "positive" | "negative";

export type Tag = {
  id: string;
  label: string;
  displayOrder: number;
  active: boolean;
  category: TagCategory | null;
  purposes: TagPurpose[];
  valence: TagValence;
};

type RawTagRow = {
  id: string;
  label: string;
  display_order: number;
  active: boolean;
  category: TagCategory | null;
  purposes: TagPurpose[];
  valence: TagValence;
};

const TAG_COLUMNS = "id, label, display_order, active, category, purposes, valence";

const CATEGORY_ORDER: TagCategory[] = ["quality", "setup", "brand", "safety", "general"];

export const TAG_CATEGORY_LABELS: Record<TagCategory, string> = {
  quality: "Photo quality",
  setup: "Lab setup",
  brand: "Brand / decals",
  safety: "Safety",
  general: "General",
};

export const TAG_PURPOSE_LABELS: Record<TagPurpose, string> = {
  quality_flag: "Camp Quality Review (issues)",
  photo_rating: "Camp Photo Review (highlights)",
  week_senior: "Week assessment",
};

export const TAG_VALENCE_LABELS: Record<TagValence, string> = {
  positive: "Positive",
  negative: "Negative",
};

/**
 * Returns the valence a tag MUST have for the given purpose, or null when the
 * purpose allows either valence. Mirrors the DB CHECK constraints in
 * migration 20260528000040.
 */
export function lockedValenceFor(purpose: TagPurpose): TagValence | null {
  if (purpose === "quality_flag") return "negative";
  if (purpose === "photo_rating") return "positive";
  return null;
}

export function purposeUsesCategory(purpose: TagPurpose): boolean {
  return purpose === "quality_flag";
}

function mapRow(r: RawTagRow): Tag {
  return {
    id: r.id,
    label: r.label,
    displayOrder: r.display_order,
    active: r.active,
    category: r.category,
    purposes: r.purposes ?? ["quality_flag"],
    valence: r.valence,
  };
}

export type FetchTagsOptions = {
  purpose?: TagPurpose;
  activeOnly?: boolean;
};

export async function fetchTags(
  supabase: SupabaseClient,
  options?: FetchTagsOptions,
): Promise<Tag[]> {
  let query = supabase
    .from("tags")
    .select(TAG_COLUMNS)
    .order("display_order", { ascending: true })
    .order("label", { ascending: true });

  if (options?.activeOnly !== false) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = ((data ?? []) as unknown as RawTagRow[]).map(mapRow);
  if (options?.purpose) {
    rows = rows.filter((t) => t.purposes.includes(options.purpose!));
  }
  return rows;
}

export function buildTagLabelLookup(tags: Tag[]): (id: string) => string {
  const map = new Map(tags.map((t) => [t.id, t.label]));
  return (id) => map.get(id) ?? id;
}

export function groupTagsByCategory(tags: Tag[]): Map<TagCategory, Tag[]> {
  const grouped = new Map<TagCategory, Tag[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const t of tags) {
    const cat = t.category ?? "general";
    const list = grouped.get(cat) ?? [];
    list.push(t);
    grouped.set(cat, list);
  }
  return grouped;
}

export function groupTagsByValence(tags: Tag[]): Map<TagValence, Tag[]> {
  const grouped = new Map<TagValence, Tag[]>([
    ["positive", []],
    ["negative", []],
  ]);
  for (const t of tags) {
    const list = grouped.get(t.valence) ?? [];
    list.push(t);
    grouped.set(t.valence, list);
  }
  return grouped;
}

export type CreateTagInput = {
  id: string;
  label: string;
  displayOrder?: number;
  category?: TagCategory | null;
  purposes?: TagPurpose[];
  valence?: TagValence;
};

export async function createTag(
  supabase: SupabaseClient,
  input: CreateTagInput,
): Promise<Tag> {
  const purposes = input.purposes ?? ["quality_flag"];
  // Derive valence when the caller hasn't pinned it: locked-by-purpose where
  // possible, default to 'negative' (matches old behavior for quality_flag).
  const valence: TagValence =
    input.valence ??
    purposes.map(lockedValenceFor).find((v): v is TagValence => v !== null) ??
    "negative";
  // Category only applies to quality_flag. Force null for everything else so
  // we don't accidentally carry a default 'general' through.
  const usesCategory = purposes.some(purposeUsesCategory);
  const category = usesCategory ? input.category ?? "general" : null;

  const { data, error } = await supabase
    .from("tags")
    .insert({
      id: input.id,
      label: input.label,
      display_order: input.displayOrder ?? 0,
      category,
      purposes,
      valence,
    })
    .select(TAG_COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error("tags insert returned no row");
  return mapRow(data as unknown as RawTagRow);
}

export type UpdateTagInput = {
  label?: string;
  displayOrder?: number;
  category?: TagCategory | null;
  valence?: TagValence;
};

export async function updateTag(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateTagInput,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.label !== undefined) row.label = patch.label;
  if (patch.displayOrder !== undefined) row.display_order = patch.displayOrder;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.valence !== undefined) row.valence = patch.valence;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from("tags").update(row).eq("id", id);
  if (error) throw error;
}

export async function updateTagCategory(
  supabase: SupabaseClient,
  id: string,
  category: TagCategory | null,
): Promise<void> {
  const { error } = await supabase.from("tags").update({ category }).eq("id", id);
  if (error) throw error;
}

export async function updateTagPurposes(
  supabase: SupabaseClient,
  id: string,
  purposes: TagPurpose[],
): Promise<void> {
  const { error } = await supabase.from("tags").update({ purposes }).eq("id", id);
  if (error) throw error;
}

export async function setTagActive(
  supabase: SupabaseClient,
  id: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase.from("tags").update({ active }).eq("id", id);
  if (error) throw error;
}

export async function deleteTag(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) throw error;
}

export function slugifyTagId(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
