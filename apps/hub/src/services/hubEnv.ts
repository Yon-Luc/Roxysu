/** True when Hub should fail closed (JWT, CORS). */
export function isHubProduction(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const node = (env.NODE_ENV ?? "").toLowerCase();
  const hub = (env.HUB_ENV ?? "").toLowerCase();
  return node === "production" || hub === "production";
}

export type CorsOrigin = string | string[];

/**
 * CORS allowlist. Dev defaults to `*`. Production requires an explicit
 * origin list — `*` and unset are rejected.
 */
export function resolveCorsOrigin(
  raw: string | undefined = process.env.CORS_ORIGIN,
  env: NodeJS.ProcessEnv = process.env,
): CorsOrigin {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (isHubProduction(env)) {
    if (parts.length === 0 || parts.includes("*")) {
      throw new Error(
        "[hub] CORS_ORIGIN must be an explicit origin list in production (not *).",
      );
    }
    return parts.length === 1 ? parts[0]! : parts;
  }

  if (parts.length === 0) return "*";
  if (parts.length === 1) return parts[0]!;
  return parts;
}
