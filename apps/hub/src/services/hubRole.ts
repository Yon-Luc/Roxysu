export type HubRole = "admin" | "user";

/** Parse ADMIN_OSU_ID; invalid/empty values mean no env-based promotion. */
export function parseAdminOsuId(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Role written on login.
 * Matching ADMIN_OSU_ID promotes to admin. An existing admin row is never
 * demoted because the env var is unset or points at someone else.
 */
export function resolveHubLoginRole(opts: {
  osuId: number;
  existingRole?: string | null;
  adminOsuId: number | null;
}): HubRole {
  if (opts.adminOsuId != null && opts.osuId === opts.adminOsuId) return "admin";
  if (opts.existingRole === "admin") return "admin";
  return "user";
}
