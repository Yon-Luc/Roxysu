export const DEFAULT_HUB_URL = "http://localhost:4322";

/** Public Hub origin used by the Electron / NixOS client app. */
export const PRODUCTION_HUB_URL = "https://roxysu-api.yonx.app";

/** Hub base URL used by Workshop, OAuth redeem, and Download Maps search-index lookup. */
export function resolveHubBaseUrl(
  raw: string | undefined = process.env.HUB_URL,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = raw?.trim();
  if (trimmed) return trimmed.replace(/\/$/, "");
  if (env.ROXYSU_DESKTOP === "1") return PRODUCTION_HUB_URL;
  return DEFAULT_HUB_URL;
}
