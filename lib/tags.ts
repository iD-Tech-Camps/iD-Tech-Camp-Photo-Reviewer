import type { SupabaseClient } from "@supabase/supabase-js";

export type TagCategory = "quality" | "setup" | "brand" | "safety" | "general";

export type TagPurpose = "quality_flag" | "photo_rating" | "week_senior";

export type Tag = {
  id: string;
  label: string;
  displayOrder: number;
  active: boolean;
  category: TagCategory;
  purposes: TagPurpose[];
};

type RawTagRow = {
  id: string;
  label: string;
  display_order: number;
  active: boolean;
  category: TagCategory;
  purposes: TagPurpose[];
};

const TAG_COLUMNS = "id, label, display_order, active, category, purposes";

const CATEGORY_ORDER: TagCategory[] = ["quality", "setup", "brand", "safety", "general"];

export const TAG_CATEGORY_LABELS: Record<TagCategory, string> = {
  quality: "Photo quality",
  setup: "Lab setup",
  brand: "Brand / decals",
  safety: "Safety",
  general: "General",
};

export const TAG_PURPOSE_LABELS: Record<TagPurpose, string> = {
  quality_flag: "Issue library (quality review)",
  photo_rating: "Photo rating tags",
  week_senior: "Week assessment (lead review)",
};

function mapRow(r: RawTagRow): Tag {
  return {
    id: r.id,
    label: r.label,
    displayOrder: r.display_order,
    active: r.active,
    category: r.category,
    purposes: r.purposes ?? ["quality_flag"],
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
    const list = grouped.get(t.category) ?? [];
    list.push(t);
    grouped.set(t.category, list);
  }
  return grouped;
}

export type CreateTagInput = {
  id: string;
  label: string;
  displayOrder?: number;
  category?: TagCategory;
  purposes?: TagPurpose[];
};

export async function createTag(
  supabase: SupabaseClient,
  input: CreateTagInput,
): Promise<Tag> {
  const { data, error } = await supabase
    .from("tags")
    .insert({
      id: input.id,
      label: input.label,
      display_order: input.displayOrder ?? 0,
      category: input.category ?? "general",
      purposes: input.purposes ?? ["quality_flag"],
    })
    .select(TAG_COLUMNS)
    .single();

  if (error) throw error;
  if (!data) throw new Error("tags insert returned no row");
  return mapRow(data as unknown as RawTagRow);
}

export async function updateTagCategory(
  supabase: SupabaseClient,
  id: string,
  category: TagCategory,
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
