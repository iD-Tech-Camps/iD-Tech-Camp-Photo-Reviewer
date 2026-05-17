import "server-only";

/** Names of env vars required for SmugMug photo sync (service role + API creds). */
export const SYNC_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SMUGMUG_API_KEY",
  "SMUGMUG_API_SECRET",
  "SMUGMUG_ACCESS_TOKEN",
  "SMUGMUG_ACCESS_TOKEN_SECRET",
] as const;

export function missingEnvVars(names: readonly string[]): string[] {
  return names.filter((name) => !process.env[name]?.trim());
}

export function syncEnvMissing(): string[] {
  return missingEnvVars(SYNC_ENV_VARS);
}
