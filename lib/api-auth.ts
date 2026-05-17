import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Role } from "@/lib/current-user";

export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" as const, status: 401 as const };
  return { supabase, user };
}

export async function requireRole(allowed: Role[]) {
  const auth = await requireUser();
  if ("error" in auth) return auth;
  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  const role = profile?.role as Role | undefined;
  if (!role || !allowed.includes(role)) {
    return { error: "Forbidden" as const, status: 403 as const };
  }
  return { ...auth, role };
}

export function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export { createServiceClient };
