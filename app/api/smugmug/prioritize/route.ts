import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Scope = "division" | "location" | "camp_week";

interface PrioritizeBody {
  scope: Scope;
  id: string;
}

function describeError(err: unknown): { message: string; details?: unknown } {
  if (err instanceof Error) return { message: err.message };
  if (err && typeof err === "object") {
    try {
      const flat = JSON.parse(JSON.stringify(err));
      const message =
        (flat && typeof flat === "object" && typeof flat.message === "string"
          ? flat.message
          : null) ?? "Unknown object error";
      return { message, details: flat };
    } catch {
      return { message: Object.prototype.toString.call(err) };
    }
  }
  return { message: String(err) };
}

async function requireAdmin() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, body: { error: "Unauthorized" } };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return { ok: false as const, status: 403, body: { error: "Forbidden" } };
  }
  return { ok: true as const, userId: user.id };
}

/**
 * Step 8.5 — "Prioritize in queue" handler. Admin-gated; flips
 * `photos.priority = 1` on every pending row under the picked
 * division / location / camp_week so those photos float to the top of
 * the reviewer queue (which orders by `priority desc, captured_at`).
 *
 * No SmugMug API calls — the picker is DB-backed (only divisions where
 * synced=true are visible). Photos belonging to camp_weeks the
 * scheduled sync hasn't ingested yet are absent from the photos table
 * and therefore unaffected; the response's `photosUpdated` count makes
 * that visible to the admin.
 *
 * V1 has no per-row unprioritize — the reset path is the mode-switch
 * "clear the queue" dialog, which deletes all unreviewed pending photos
 * and lets the next sync rebuild at priority = 0.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let body: PrioritizeBody;
  try {
    body = (await req.json()) as PrioritizeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || (body.scope !== "division" && body.scope !== "location" && body.scope !== "camp_week")) {
    return NextResponse.json({ error: "scope_required" }, { status: 400 });
  }
  if (!body.id || typeof body.id !== "string") {
    return NextResponse.json({ error: "id_required" }, { status: 400 });
  }

  const service = createServiceClient();

  let syncLogId: string | null = null;
  try {
    // 1. Resolve the camp_week ids to target. Walk the tree downward
    //    from whatever scope was picked; an empty list means "no
    //    camp_weeks under this node yet" — still a valid request,
    //    just a no-op update count.
    const campWeekIds = await resolveCampWeekIds(service, body.scope, body.id);

    // 2. Insert in-flight sync_log row.
    const { data: logRow, error: logErr } = await service
      .from("sync_log")
      .insert({
        kind: "priority_add",
        status: "success", // placeholder; finalized below
        triggered_by: auth.userId,
      })
      .select("id")
      .single();
    if (logErr || !logRow) throw new Error(`sync_log insert failed: ${logErr?.message ?? "no row"}`);
    syncLogId = logRow.id as string;

    // 3. Bulk update photos. The `priority < 1` predicate keeps the
    //    update count honest — re-prioritizing the same subtree is a
    //    no-op count rather than re-touching every row.
    let photosUpdated = 0;
    if (campWeekIds.length > 0) {
      const { data: updated, error: updErr } = await service
        .from("photos")
        .update({ priority: 1, updated_at: new Date().toISOString() })
        .in("camp_week_id", campWeekIds)
        .eq("current_status", "pending")
        .lt("priority", 1)
        .select("id");
      if (updErr) throw new Error(`photos priority update failed: ${updErr.message}`);
      photosUpdated = (updated ?? []).length;
    }

    // 4. Resolve a friendly name for the response + log summary.
    const scopeName = await resolveScopeName(service, body.scope, body.id);

    // 5. Finalize sync_log + smugmug_config.last_sync_*.
    const finishedAt = new Date().toISOString();
    await service
      .from("sync_log")
      .update({
        finished_at: finishedAt,
        status: "success",
        photos_updated: photosUpdated,
      })
      .eq("id", syncLogId);

    await service
      .from("smugmug_config")
      .update({
        last_sync_at: finishedAt,
        last_sync_status: `priority_add · ~${photosUpdated} (${scopeName ?? body.scope})`,
        updated_at: finishedAt,
      })
      .eq("id", 1);

    return NextResponse.json({
      ok: true,
      photosUpdated,
      campWeeksTouched: campWeekIds.length,
      scope: { kind: body.scope, id: body.id, name: scopeName },
      syncLogId,
    });
  } catch (err) {
    console.error("[prioritize POST] error:", err);
    if (syncLogId) {
      await service
        .from("sync_log")
        .update({
          finished_at: new Date().toISOString(),
          status: "failed",
          error_summary: err instanceof Error ? err.message : String(err),
        })
        .eq("id", syncLogId);
    }
    const desc = describeError(err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error", message: desc.message, details: desc.details },
      { status: 500 }
    );
  }
}

async function resolveCampWeekIds(
  service: ReturnType<typeof createServiceClient>,
  scope: Scope,
  id: string,
): Promise<string[]> {
  if (scope === "camp_week") return [id];

  if (scope === "location") {
    const { data, error } = await service
      .from("camp_weeks")
      .select("id")
      .eq("location_id", id);
    if (error) throw new Error(`camp_weeks lookup failed: ${error.message}`);
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  }

  // division: join camp_weeks → locations
  const { data: locs, error: locsErr } = await service
    .from("locations")
    .select("id")
    .eq("division_id", id);
  if (locsErr) throw new Error(`locations lookup failed: ${locsErr.message}`);
  const locIds = ((locs ?? []) as { id: string }[]).map((r) => r.id);
  if (locIds.length === 0) return [];

  const { data, error } = await service
    .from("camp_weeks")
    .select("id")
    .in("location_id", locIds);
  if (error) throw new Error(`camp_weeks (by div) lookup failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

async function resolveScopeName(
  service: ReturnType<typeof createServiceClient>,
  scope: Scope,
  id: string,
): Promise<string | null> {
  const table =
    scope === "division" ? "divisions" : scope === "location" ? "locations" : "camp_weeks";
  const { data } = await service.from(table).select("name").eq("id", id).maybeSingle();
  return ((data as { name: string } | null) ?? null)?.name ?? null;
}
