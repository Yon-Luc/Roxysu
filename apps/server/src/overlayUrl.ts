import { URL_MAX } from "./requestLimits";

export const OVERLAY_OUTPUT_MAX = 128;

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

export type OverlayOutputResult =
  | { ok: true; output: string }
  | { ok: false; error: string };

/** Connector or model passed through as a single `--output=` argv token. */
export function parseOverlayOutput(raw: string): OverlayOutputResult {
  const output = raw.trim();
  if (!output || output.length > OVERLAY_OUTPUT_MAX || output.startsWith("-")) {
    return { ok: false, error: "overlayOutput must be a monitor connector or model" };
  }
  if (/[\u0000-\u001F\u007F]/.test(output)) {
    return { ok: false, error: "overlayOutput must be a monitor connector or model" };
  }
  return { ok: true, output };
}
