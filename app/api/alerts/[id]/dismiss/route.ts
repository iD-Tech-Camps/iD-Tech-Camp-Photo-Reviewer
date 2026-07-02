import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Dismiss an upload alert. Lead-only. The alert record stays (for history) but
 * drops out of the active feed. Dismissing an already-dismissed alert is a 409.
 *
 * POST /api/alerts/:id/dismiss
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(["senior", "admin"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: alertId } = await ctx.params;
  if (!alertId) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const { data, error } = await auth.supabase.rpc("dismiss_upload_alert", {
    p_alert_id: alertId,
  });

  if (error) {
    // P0002 = raised when there's no active (undismissed) alert with this id.
    if (error.code === "P0002") {
      return NextResponse.json(
        { error: "not_active", message: "Alert already dismissed." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ alert: data });
}
