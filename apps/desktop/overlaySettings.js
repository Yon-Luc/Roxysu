"use strict";

/**
 * Parse the client-app settings payload for the In-game overlay host
 * (desktop M7 / F-066). `GET /api/settings` is only trusted when it answers
 * HTTP 200 AND the JSON carries an `overlay` object with a boolean
 * `enabled`. A non-2xx error document (e.g. 500 `{"error":…}`) must count as
 * a failed poll — not as "enabled with the default HUD URL", which could
 * respawn a host the user just disabled. Keep the shape in sync with
 * `buildSettingsResponse` in apps/server/src/routes/settings.ts.
 *
 * Pure module — no Electron imports so it can be unit-tested with bun.
 */

/** Byte cap for the settings poll body. The real payload is a few KiB. */
const MAX_OVERLAY_SETTINGS_BYTES = 64 * 1024;

/**
 * @param {number} statusCode
 * @param {string} raw
 * @returns {{ enabled: boolean, hostUrl: string | null, output: string | null, restartAt: number | null } | null}
 *   Null when the response is not a trustworthy settings document.
 */
function parseOverlaySettingsResponse(statusCode, raw) {
  if (statusCode !== 200) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const overlay = parsed?.overlay;
  if (
    overlay == null ||
    typeof overlay !== "object" ||
    Array.isArray(overlay)
  ) {
    return null;
  }
  if (typeof overlay.enabled !== "boolean") return null;
  const hostUrl =
    typeof overlay.hostUrl === "string" && overlay.hostUrl.trim()
      ? overlay.hostUrl.trim()
      : null;
  const output =
    typeof overlay.output === "string" && overlay.output.trim()
      ? overlay.output.trim()
      : null;
  const restartAt =
    typeof overlay.restartAt === "number" && Number.isFinite(overlay.restartAt)
      ? overlay.restartAt
      : null;
  return { enabled: overlay.enabled, hostUrl, output, restartAt };
}

/**
 * Read an HTTP response body with a byte cap, destroying the response past
 * the cap so a wedged stream cannot grow the main-process heap. Mirrors the
 * server's readCappedText pattern.
 *
 * @param {NodeJS.ReadableStream & { destroy?: () => void }} res
 * @param {number} maxBytes
 * @returns {Promise<{ ok: true, text: string } | { ok: false }>}
 */
function readCappedBody(res, maxBytes) {
  return new Promise((resolve) => {
    let received = 0;
    let text = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    res.on("data", (chunk) => {
      if (settled) return;
      received += chunk.length;
      if (received > maxBytes) {
        try {
          res.destroy?.();
        } catch {
          // already gone
        }
        finish({ ok: false });
        return;
      }
      text += chunk;
    });
    res.on("end", () => finish({ ok: true, text }));
    res.on("aborted", () => finish({ ok: false }));
    res.on("error", () => finish({ ok: false }));
  });
}

module.exports = {
  MAX_OVERLAY_SETTINGS_BYTES,
  parseOverlaySettingsResponse,
  readCappedBody,
};
