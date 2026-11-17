export const DEFAULT_HUB_URL = "http://localhost:4322";

/** Public Hub origin used by the Electron / NixOS client app. */
export const PRODUCTION_HUB_URL = "https://roxysu-api.yonx.app";

/**
 * Explicit `HUB_URL`: http(s), a hostname, no userinfo. A trailing slash is
 * stripped. Other schemes are refused.
 */
export function parseHubBaseUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "HUB_URL must be an http(s) URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "HUB_URL must be an http(s) URL" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "HUB_URL must not include credentials" };
  }
  if (!url.hostname) {
    return { ok: false, error: "HUB_URL must be an http(s) URL" };
  }
  const host = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
  const port = url.port ? `:${url.port}` : "";
  const path = url.pathname.replace(/\/$/, "");
  return { ok: true, url: `${url.protocol}//${host}${port}${path}` };
}

/** Hub base URL used by Workshop, OAuth redeem, and Download Maps search-index lookup. */
export function resolveHubBaseUrl(
  raw: string | undefined = process.env.HUB_URL,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = raw?.trim();
  if (trimmed) {
    const parsed = parseHubBaseUrl(trimmed);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.url;
  }
  if (env.ROXYSU_DESKTOP === "1") return PRODUCTION_HUB_URL;
  return DEFAULT_HUB_URL;
}
