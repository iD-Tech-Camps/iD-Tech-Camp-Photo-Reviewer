import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROLES = ["reviewer", "senior", "admin"] as const;

// Dev-only: switch the signed-in dev user's role so a single login can preview
// every view. Guarded by NEXT_PUBLIC_DEV_AUTH; 404s in production.
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_DEV_AUTH !== "1") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const auth = await requireUser();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const role = body?.role as string | undefined;
  if (!role || !(ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }
  const { error } = await createServiceClient()
    .from("profiles")
    .update({ role })
    .eq("id", auth.user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, role });
}
