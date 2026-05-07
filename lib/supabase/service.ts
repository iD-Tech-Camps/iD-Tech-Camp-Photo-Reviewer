import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS entirely — only call from
 * Route Handlers that have already enforced their own authorization
 * (typically an admin-role check). Never bundle into a client component.
 *
 * The service-role key is the long secret value under Supabase Dashboard
 * → Project Settings → API → "service_role". Anyone holding it can read
 * and write any row in the project.
 *
 * `auth.persistSession = false` avoids polluting the cookie store; this
 * client is request-scoped and never represents a real end user.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Service-role Supabase client missing config. " +
        "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
