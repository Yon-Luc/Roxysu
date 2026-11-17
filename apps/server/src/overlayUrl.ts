import { URL_MAX } from "./requestLimits";

export type OverlayUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** http(s) URL with no userinfo. Hash routes such as `#/overlay` stay intact. */
export function parseOverlayHostUrl(raw: string): OverlayUrlResult {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > URL_MAX) {
    return { ok: false, error: "overlayHostUrl must be an http(s) URL" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "overlayHostUrl must be an http(s) URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "overlayHostUrl must be an http(s) URL" };
  }
  if (url.username || url.password || !url.hostname) {
    return { ok: false, error: "overlayHostUrl must be an http(s) URL" };
  }
  return { ok: true, url: trimmed };
}
