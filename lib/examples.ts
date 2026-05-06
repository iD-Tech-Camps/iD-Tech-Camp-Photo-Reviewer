import type { SupabaseClient } from "@supabase/supabase-js";

// Example library — admin-managed reference photos shown to reviewers in
// the Guide screen. Backed by `public.examples` (migration 7) plus the
// `example-images` storage bucket (migration 18).
//
// Every active row has either a `storage_path` (modern, uploaded via the
// Admin UI — resolved to a public URL through the SDK) or a free-form
// `image_url` (escape hatch for hand-seeded rows). The derived `imageUrl`
// on the runtime type prefers storage_path so admins always know the
// uploaded image is what reviewers see.

export const EXAMPLES_BUCKET = "example-images";

export type ExampleKind = "good" | "bad";

export type Example = {
  id: string;
  kind: ExampleKind;
  label: string;
  note: string;
  storagePath: string | null;
  imageUrl: string;       // resolved public URL (preferred) or raw image_url fallback
  rawImageUrl: string | null;
  displayOrder: number;
  active: boolean;
  createdAt: string;
};

type RawExampleRow = {
  id: string;
  kind: ExampleKind;
  label: string;
  note: string | null;
  image_url: string | null;
  storage_path: string | null;
  display_order: number;
  active: boolean;
  created_at: string;
};

const COLUMNS =
  "id, kind, label, note, image_url, storage_path, display_order, active, created_at";

// Resolve the public URL for a storage object. Use the SDK helper rather
// than hand-building the URL so the bucket-id-in-path convention stays
// owned by the SDK (it changed once between Supabase versions; not worth
// re-debugging).
function publicUrlFor(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(EXAMPLES_BUCKET).getPublicUrl(path).data.publicUrl;
}

function mapRow(supabase: SupabaseClient, r: RawExampleRow): Example {
  const resolvedFromStorage = r.storage_path
    ? publicUrlFor(supabase, r.storage_path)
    : "";
  return {
    id:           r.id,
    kind:         r.kind,
    label:        r.label,
    note:         r.note ?? "",
    storagePath:  r.storage_path,
    rawImageUrl:  r.image_url,
    imageUrl:     resolvedFromStorage || r.image_url || "",
    displayOrder: r.display_order,
    active:       r.active,
    createdAt:    r.created_at,
  };
}

// Generate a unique storage path for a new upload. Using a UUID keeps the
// path opaque (no collisions, no cache-bust headache on replace because
// every replace lands a fresh path), and the file extension preserves
// content-type sniffing for browsers that need it.
function generateStoragePath(file: File): string {
  const ext = (() => {
    const fromName = file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
    if (fromName) return fromName;
    const fromMime = file.type.split("/")[1]?.toLowerCase();
    return fromMime || "bin";
  })();
  // crypto.randomUUID is available in modern browsers + recent Node; the
  // app is already client-only here so we don't need a fallback.
  const uuid = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${uuid}.${ext}`;
}

// ─── reads ──────────────────────────────────────────────────────────────────

// Returns active examples, ordered by display_order then created_at desc
// so admin curation is respected and brand-new uploads land predictably
// at the bottom (same order createExample assigns them).
export async function fetchExamples(
  supabase: SupabaseClient,
  kind?: ExampleKind,
): Promise<Example[]> {
  let q = supabase
    .from("examples")
    .select(COLUMNS)
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("created_at",    { ascending: false });

  if (kind) q = q.eq("kind", kind);

  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown as RawExampleRow[]).map((r) => mapRow(supabase, r));
}

// ─── writes ─────────────────────────────────────────────────────────────────

export type CreateExampleInput = {
  kind: ExampleKind;
  label: string;
  note: string;
  file: File;
};

// Upload the file to storage, then insert the row. If the insert fails
// we make a best-effort attempt to delete the just-uploaded object so we
// don't accumulate orphans in the bucket.
export async function createExample(
  supabase: SupabaseClient,
  input: CreateExampleInput,
): Promise<Example> {
  const path = generateStoragePath(input.file);

  const { error: uploadError } = await supabase
    .storage
    .from(EXAMPLES_BUCKET)
    .upload(path, input.file, {
      cacheControl: "3600",
      upsert: false,
      contentType: input.file.type || undefined,
    });
  if (uploadError) throw uploadError;

  const imageUrl = publicUrlFor(supabase, path);

  // New rows land at max(display_order) + 1 within their kind so they
  // appear at the end of the admin grid + Guide screen. We could compute
  // this in a trigger but it's a single extra round-trip and keeping the
  // logic in JS is easier to follow.
  const { data: maxRow, error: maxErr } = await supabase
    .from("examples")
    .select("display_order")
    .eq("kind", input.kind)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxErr) {
    await supabase.storage.from(EXAMPLES_BUCKET).remove([path]).catch(() => {});
    throw maxErr;
  }
  const nextOrder = (maxRow?.display_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("examples")
    .insert({
      kind:          input.kind,
      label:         input.label,
      note:          input.note || null,
      storage_path:  path,
      image_url:     imageUrl,
      display_order: nextOrder,
      active:        true,
    })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    await supabase.storage.from(EXAMPLES_BUCKET).remove([path]).catch(() => {});
    throw error ?? new Error("examples insert returned no row");
  }
  return mapRow(supabase, data as unknown as RawExampleRow);
}

export type UpdateExampleMetadataInput = {
  label?: string;
  note?: string;
  kind?: ExampleKind;
  displayOrder?: number;
  active?: boolean;
};

// Metadata-only update. No file changes. Use replaceExampleImage for
// swapping the underlying file (it has cleanup semantics this doesn't).
export async function updateExampleMetadata(
  supabase: SupabaseClient,
  id: string,
  patch: UpdateExampleMetadataInput,
): Promise<Example> {
  const rowPatch: Record<string, unknown> = {};
  if (patch.label        !== undefined) rowPatch.label         = patch.label;
  if (patch.note         !== undefined) rowPatch.note          = patch.note || null;
  if (patch.kind         !== undefined) rowPatch.kind          = patch.kind;
  if (patch.displayOrder !== undefined) rowPatch.display_order = patch.displayOrder;
  if (patch.active       !== undefined) rowPatch.active        = patch.active;

  const { data, error } = await supabase
    .from("examples")
    .update(rowPatch)
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  if (!data) throw new Error("examples update returned no row");
  return mapRow(supabase, data as unknown as RawExampleRow);
}

// Replace the underlying image. Uploads the new file to a fresh path,
// updates the row, then removes the old object. Doing it in this order
// means the row never points at a missing file: if the new upload fails
// we never touched the old; if the old delete fails we still have a
// valid row pointing at the new file.
export async function replaceExampleImage(
  supabase: SupabaseClient,
  id: string,
  file: File,
): Promise<Example> {
  const { data: existingRow, error: existingErr } = await supabase
    .from("examples")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (existingErr) throw existingErr;
  const oldPath = (existingRow as { storage_path: string | null } | null)?.storage_path ?? null;

  const newPath = generateStoragePath(file);
  const { error: uploadError } = await supabase
    .storage
    .from(EXAMPLES_BUCKET)
    .upload(newPath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
  if (uploadError) throw uploadError;

  const newUrl = publicUrlFor(supabase, newPath);
  const { data, error } = await supabase
    .from("examples")
    .update({ storage_path: newPath, image_url: newUrl })
    .eq("id", id)
    .select(COLUMNS)
    .single();

  if (error || !data) {
    await supabase.storage.from(EXAMPLES_BUCKET).remove([newPath]).catch(() => {});
    throw error ?? new Error("examples update returned no row");
  }

  if (oldPath && oldPath !== newPath) {
    await supabase.storage.from(EXAMPLES_BUCKET).remove([oldPath]).catch((err) => {
      console.warn("[examples] failed to delete old storage object", oldPath, err);
    });
  }

  return mapRow(supabase, data as unknown as RawExampleRow);
}

// Delete the storage object first, then the row. Reversing this order
// would risk the row referencing a missing file mid-failure; this way a
// failed object delete (e.g. it was already removed manually) doesn't
// block the row deletion. We log + swallow storage errors as 404s are
// expected on already-cleaned-up objects.
export async function deleteExample(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { data: existing, error: fetchErr } = await supabase
    .from("examples")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  const path = (existing as { storage_path: string | null } | null)?.storage_path ?? null;

  if (path) {
    const { error: storageErr } = await supabase
      .storage
      .from(EXAMPLES_BUCKET)
      .remove([path]);
    if (storageErr) {
      console.warn("[examples] storage delete returned error (continuing):", storageErr);
    }
  }

  const { error } = await supabase
    .from("examples")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Persist a new ordering for the given kind. Single transactional RPC so
// a partial failure can't leave display_order half-applied.
export async function reorderExamples(
  supabase: SupabaseClient,
  kind: ExampleKind,
  orderedIds: string[],
): Promise<void> {
  const { error } = await supabase.rpc("reorder_examples", {
    p_kind: kind,
    p_ordered_ids: orderedIds,
  });
  if (error) throw error;
}
