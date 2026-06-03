import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { seedGalleryFromFixture } from "@/lib/dev/gallery-seed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Dev-only: reseed the local DB from the captured fixture. Guarded by the same
// flag that exposes the dev sign-in form; production never sets it, so this
// route 404s there. Uses the service client (local key in dev env).
export async function POST() {
  if (process.env.NEXT_PUBLIC_DEV_AUTH !== "1") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const result = await seedGalleryFromFixture(createServiceClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
