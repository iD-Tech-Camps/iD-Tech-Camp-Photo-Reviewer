import { vi } from "vitest";
import { authedClientFor, service } from "./fixtures";

export type MockAuthMode =
  | { kind: "unauthenticated" }
  | {
      kind: "user";
      userId: string;
      role?: "reviewer" | "senior" | "admin";
      // When the route calls an RPC that checks auth.uid() (e.g.
      // is_senior_or_admin), pass `email` so the mock returns a JWT-authed
      // client instead of the service client. Without it, auth.uid() inside
      // the RPC is null and SECURITY DEFINER guard checks reject the call.
      email?: string;
    };

const state: { mode: MockAuthMode } = { mode: { kind: "unauthenticated" } };

export function setMockAuth(mode: MockAuthMode): void {
  state.mode = mode;
}

async function clientForMode(mode: Extract<MockAuthMode, { kind: "user" }>) {
  return mode.email ? await authedClientFor(mode.email) : service();
}

vi.mock("@/lib/api-auth", async () => {
  const { createServiceClient } = await import("@/lib/supabase/service");

  return {
    createServiceClient,
    verifyCronSecret: (request: Request): boolean => {
      const secret = process.env.CRON_SECRET;
      if (!secret) return false;
      return request.headers.get("authorization") === `Bearer ${secret}`;
    },
    requireUser: async () => {
      if (state.mode.kind === "unauthenticated") {
        return { error: "Unauthorized" as const, status: 401 as const };
      }
      return { supabase: await clientForMode(state.mode), user: { id: state.mode.userId } };
    },
    requireRole: async (allowed: Array<"reviewer" | "senior" | "admin">) => {
      if (state.mode.kind === "unauthenticated") {
        return { error: "Unauthorized" as const, status: 401 as const };
      }
      const role = state.mode.role;
      if (!role || !allowed.includes(role)) {
        return { error: "Forbidden" as const, status: 403 as const };
      }
      return {
        supabase: await clientForMode(state.mode),
        user: { id: state.mode.userId },
        role,
      };
    },
  };
});
