"use strict";

/**
 * Shell-side guard for In-game overlay argv (desktop L7). The server
 * validates `overlay.host_url` / `overlay.host_output` on PATCH
 * (apps/server/src/overlayUrl.ts), but the shell is the process that execs
 * the host — re-check the values read from GET /api/settings before they
 * reach argv, so a value that reached the settings table without PATCH
 * (manual edit, older import, a future writer) cannot point the WebKit view
 * at an arbitrary origin or pin a nonsense monitor.
 *
 * Keep the rules in sync with apps/server/src/overlayUrl.ts
 * (parseOverlayHostUrl / parseOverlayOutput) and its tests.
 *
 * Pure module — no Electron imports so it can be unit-tested with bun.
 */

/** Same cap as URL_MAX in apps/server/src/requestLimits.ts. */
const OVERLAY_URL_MAX = 2048;
/** Same cap as OVERLAY_OUTPUT_MAX in apps/server/src/overlayUrl.ts. */
const OVERLAY_OUTPUT_MAX = 128;

/**
 * @param {string} raw
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
function parseOverlayHostUrl(raw) {
  const error = "overlay host URL must be an http(s) URL without credentials";
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > OVERLAY_URL_MAX) {
    return { ok: false, error };
  }
  /** @type {URL} */
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error };
  }
  if (url.username || url.password || !url.hostname) {
    return { ok: false, error };
  }
  return { ok: true, url: trimmed };
}

/**
 * @param {string} raw
 * @returns {{ ok: true, output: string } | { ok: false, error: string }}
 */
function parseOverlayOutput(raw) {
  const error = "overlay output must be a monitor connector or model";
  const output = raw.trim();
  if (!output || output.length > OVERLAY_OUTPUT_MAX || output.startsWith("-")) {
    return { ok: false, error };
  }
  if (/[\u0000-\u001F\u007F]/.test(output)) {
    return { ok: false, error };
  }
  return { ok: true, output };
}

module.exports = {
  OVERLAY_OUTPUT_MAX,
  OVERLAY_URL_MAX,
  parseOverlayHostUrl,
  parseOverlayOutput,
};
