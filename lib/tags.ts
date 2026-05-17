import type { SupabaseClient } from "@supabase/supabase-js";

export type TagCategory = "quality" | "setup" | "brand" | "safety" | "general";

export type Tag = {
  id: string;
  label: string;
  displayOrder: number;
  active: boolean;
  category: TagCategory;
};

type RawTagRow = {
  id: string;
  label: string;
  display_order: number;
  active: boolean;
  category: TagCategory;
};

const TAG_COLUMNS = "id, label, display_order, active, category";

const CATEGORY_ORDER: TagCategory[] = ["quality", "setup", "brand", "safety", "general"];

export const TAG_CATEGORY_LABELS: Record<TagCategory, string> = {
  quality: "Photo quality",
  setup: "Lab setup",
  brand: "Brand / decals",
  safety: "Safety",
  general: "General",
};

function mapRow(r: RawTagRow): Tag {
  return {
    id: r.id,
    label: r.label,
    displayOrder: r.display_order,
    active: r.active,
    category: r.category,
  };
}

export async function fetchTags(supabase: SupabaseClient): Promise<Tag[]> {
  const { data, error } = await supabase
    .from("tags")
    .select(TAG_COLUMNS)
    .order("display_order", { ascending: true })
    .order("label", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as unknown as RawTagRow[]).map(mapRow);
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
