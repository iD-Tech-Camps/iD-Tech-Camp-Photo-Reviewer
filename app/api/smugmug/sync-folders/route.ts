import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getAuthUser, SmugMugApiError } from "@/lib/smugmug";
import { walkDivisions, walkDivisionDeep } from "@/lib/smugmug/sync/walker";
import {
  reconcileTopLevelDivisions,
  reconcileDivisionDeep,
} from "@/lib/smugmug/sync/reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 5 minutes; only takes effect on Vercel Pro+. Hobby remains capped at 10s.
export const maxDuration = 300;

function describeError(err: unknown): {
  message: string;
  details?: unknown;
} {
  if (err instanceof Error) {
    const detail: Record<string, unknown> = {};
    if ("cause" in err && err.cause) detail.cause = describeError(err.cause).message;
    return { message: err.message, details: Object.keys(detail).length ? detail : undefined };
  }
  if (err && typeof err === "object") {
    // Supabase errors are plain objects with code/message/details/hint.
    // Serialize their enumerable props so the response is actually
    // useful instead of "[object Object]".
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
  const supabase = await createClient();
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
  return { ok: true as const, supabase };
}

/**
 * Step 8.3a — discovery endpoint. Read-only, admin-only.
 *
 * GET /api/smugmug/sync-folders
 *   → top-level: lists every division SmugMug shows under the iD Tech
 *     account, cross-referenced against rows in public.divisions so we
 *     can see which are already known, which still carry placeholder
 *     smugmug_folder_ids, and which are flagged for deep sync (synced=true).
 *
 * GET /api/smugmug/sync-folders?division=<smugmugNodeId>
 *   → deep walk: also walks locations + year folders + weeks under the
 *     specified division. Each week's name is run through the iD Tech
 *     date parser; weeks that fail to parse surface with parsed = null
 *     so we can spot naming-convention drift before the apply step.
 *
 * No DB writes here. The apply step (8.3b → POST) does the reconciliation.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });
  const supabase = auth.supabase;

  try {
    const smugUser = await getAuthUser();
    const { rootNodeId, divisions } = await walkDivisions(smugUser.NickName);

    const { data: dbDivisions } = await supabase
      .from("divisions")
      .select("id, name, smugmug_folder_id, synced");
    const dbByName = new Map<string, (typeof dbDivisions)[number]>();
    const dbByFolderId = new Map<string, (typeof dbDivisions)[number]>();
    for (const d of dbDivisions ?? []) {
      dbByName.set(d.name, d);
      dbByFolderId.set(d.smugmug_folder_id, d);
    }

    const annotatedDivisions = divisions.map((div) => {
      // Match by real SmugMug ID first, fall back to name match for
      // placeholder reconciliation.
      const byId = dbByFolderId.get(div.smugmugNodeId);
      const byName = dbByName.get(div.name);
      const dbRow = byId ?? byName;
      const isPlaceholder = dbRow?.smugmug_folder_id?.startsWith("placeholder-") ?? false;
      return {
        ...div,
        inDb: Boolean(dbRow),
        dbId: dbRow?.id ?? null,
        dbSmugmugFolderId: dbRow?.smugmug_folder_id ?? null,
        isPlaceholder,
        matchKind: byId ? "by_id" : byName ? "by_name" : null,
        synced: dbRow?.synced ?? false,
      };
    });

    const requested = req.nextUrl.searchParams.get("division");
    let deep: Awaited<ReturnType<typeof walkDivisionDeep>> | null = null;
    if (requested) {
      const target = divisions.find((d) => d.smugmugNodeId === requested);
      if (!target) {
        return NextResponse.json(
          {
            ok: false,
            error: "division_not_found_under_root",
            requested,
            available: divisions.map((d) => ({ id: d.smugmugNodeId, name: d.name })),
          },
          { status: 404 }
        );
      }
      deep = await walkDivisionDeep(target.smugmugNodeId, target.name, target.type);
    }

    return NextResponse.json({
      ok: true,
      smugmug: {
        nickName: smugUser.NickName,
        rootNodeId,
      },
      divisions: annotatedDivisions,
      deep,
      hint: requested
        ? null
        : "Pass ?division=<smugmugNodeId> to walk one division's locations + weeks for inspection.",
    });
  } catch (err) {
    console.error("[sync-folders GET] error:", err);
    if (err instanceof SmugMugApiError) {
      return NextResponse.json(
        {
          ok: false,
          error: "smugmug_api_error",
          status: err.status,
          url: err.url,
          body: err.bodyExcerpt,
        },
        { status: 502 }
      );
    }
    const desc = describeError(err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error", message: desc.message, details: desc.details },
      { status: 500 }
    );
  }
}

/**
 * Step 8.3b — apply endpoint. Admin-only, writes via the service-role
 * client (bypasses RLS on divisions / locations / camp_weeks).
 *
 * POST /api/smugmug/sync-folders
 *   → top-level only: walks SmugMug's root, upserts every Folder it
 *     finds into public.divisions. Cheap. Albums at root are skipped
 *     (and counted in the response). New rows land with synced=false;
 *     existing placeholder rows whose names match real folders get their
 *     smugmug_folder_id replaced in place.
 *
 * POST /api/smugmug/sync-folders?division=<smugmugNodeId>
 *   → deep apply: also walks the division's locations + year folders +
 *     weeks and reconciles them. The targeted division must already have
 *     synced=true in the DB (a top-level apply runs first if it doesn't).
 *     Weeks whose folder names don't fit the iD Tech date convention are
 *     skipped and listed in the response so the admin can spot naming
 *     drift without losing the rest of the run.
 *
 * Idempotent: re-running with the same SmugMug state is a no-op.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const service = createServiceClient();

  try {
    const smugUser = await getAuthUser();
    const { divisions } = await walkDivisions(smugUser.NickName);

    const divisionsResult = await reconcileTopLevelDivisions(service, divisions);

    const requested = req.nextUrl.searchParams.get("division");
    if (!requested) {
      return NextResponse.json({
        ok: true,
        scope: "top_level_only",
        divisions: divisionsResult,
        deep: null,
        hint:
          "POST again with ?division=<smugmugNodeId> to deep-walk one division's " +
          "locations + weeks. Target division must have synced=true.",
      });
    }

    const target = divisions.find((d) => d.smugmugNodeId === requested);
    if (!target) {
      return NextResponse.json(
        {
          ok: false,
          error: "division_not_found_under_root",
          requested,
          available: divisions.map((d) => ({ id: d.smugmugNodeId, name: d.name })),
        },
        { status: 404 }
      );
    }
    if (target.type !== "Folder") {
      return NextResponse.json(
        { ok: false, error: "division_is_not_a_folder", type: target.type },
        { status: 400 }
      );
    }

    // Refuse to deep-walk a division that isn't flagged for sync —
    // catches "I forgot to flip synced=true and just spent 60s walking
    // the wrong tree" before it happens.
    const { data: targetRow } = await service
      .from("divisions")
      .select("id, synced")
      .eq("smugmug_folder_id", target.smugmugNodeId)
      .single();
    if (!targetRow) {
      return NextResponse.json(
        { ok: false, error: "division_not_in_db_after_top_level_reconcile" },
        { status: 500 }
      );
    }
    if (!targetRow.synced) {
      return NextResponse.json(
        {
          ok: false,
          error: "division_not_synced",
          message:
            "Set synced=true on this division before deep-applying. " +
            "(Until the admin UI lands in 8.5: SQL it: " +
            "update public.divisions set synced=true where smugmug_folder_id='" +
            target.smugmugNodeId +
            "';)",
        },
        { status: 409 }
      );
    }

    const deepWalked = await walkDivisionDeep(target.smugmugNodeId, target.name, target.type);
    const deepResult = await reconcileDivisionDeep(service, deepWalked);

    return NextResponse.json({
      ok: true,
      scope: "deep",
      divisions: divisionsResult,
      deep: deepResult,
    });
  } catch (err) {
    console.error("[sync-folders POST] error:", err);
    if (err instanceof SmugMugApiError) {
      return NextResponse.json(
        {
          ok: false,
          error: "smugmug_api_error",
          status: err.status,
          url: err.url,
          body: err.bodyExcerpt,
        },
        { status: 502 }
      );
    }
    const desc = describeError(err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error", message: desc.message, details: desc.details },
      { status: 500 }
    );
  }
}
