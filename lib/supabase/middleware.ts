import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Vercel-Cron entry points have no Supabase user session by design (cron
// auth is a CRON_SECRET bearer token, enforced inside each route handler).
// Without this whitelist the middleware redirects every cron call to /login
// and the handler never runs. tests/unit/middleware-public-paths.test.ts
// fails if a cron in vercel.json is missing here.
export const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/api/smugmug/sync-scheduled",
  "/api/triage/sweep-claims",
  "/api/photo-rating/sweep-claims",
  "/api/alerts/weekly-upload-check",
  // AI tagging cron (CRON_SECRET) and photo search, which accepts either a
  // session or a bot bearer key — both routes enforce auth themselves.
  "/api/ai-tagging/sweep",
  "/api/photos/ai-search",
];

export function isPublicPath(pathname: string) {
  // Dev-only seed/role helpers bypass the login redirect when the dev sign-in
  // flag is on (local only); production never sets it. The handlers re-check
  // the flag and (for /role) the session, so this only skips the redirect.
  if (process.env.NEXT_PUBLIC_DEV_AUTH === "1" && pathname.startsWith("/api/dev/")) {
    return true;
  }
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: DO NOT REMOVE auth.getUser() call.
  // This refreshes the session and must run between
  // createServerClient and returning supabaseResponse.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
