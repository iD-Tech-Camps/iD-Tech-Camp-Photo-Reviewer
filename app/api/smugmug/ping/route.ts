import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, SmugMugApiError } from "@/lib/smugmug";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin-only smoke endpoint that confirms the SmugMug client is wired up:
 * signing math, credentials, network reachability, response parsing.
 *
 * Returns the authenticated SmugMug user's nickname on success, a structured
 * SmugMug error on API failure, or 401/403 if the caller isn't an admin.
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const smug = await getAuthUser();
    return NextResponse.json({
      ok: true,
      smugmug: {
        nickName: smug.NickName,
        name: smug.Name,
        uri: smug.Uri,
        accountStatus: smug.AccountStatus ?? null,
      },
    });
  } catch (err) {
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
    return NextResponse.json(
      {
        ok: false,
        error: "unexpected_error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
