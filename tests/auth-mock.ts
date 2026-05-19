import { vi } from "vitest";
import { service } from "./fixtures";

export type MockAuthMode =
  | { kind: "unauthenticated" }
  | { kind: "user"; userId: string; role?: "reviewer" | "senior" | "admin" };

const state: { mode: MockAuthMode } = { mode: { kind: "unauthenticated" } };

export function setMockAuth(mode: MockAuthMode): void {
  state.mode = mode;
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
      return { supabase: service(), user: { id: state.mode.userId } };
    },
    requireRole: async (allowed: Array<"reviewer" | "senior" | "admin">) => {
      if (state.mode.kind === "unauthenticated") {
        return { error: "Unauthorized" as const, status: 401 as const };
      }
      const role = state.mode.role;
      if (!role || !allowed.includes(role)) {
        return { error: "Forbidden" as const, status: 403 as const };
      }
      return { supabase: service(), user: { id: state.mode.userId }, role };
    },
  };
});
