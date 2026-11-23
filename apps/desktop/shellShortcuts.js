"use strict";

/**
 * DD-9: Windows/Linux have no application menu, so Electron's default zoom /
 * reload / fullscreen accelerators do not exist. The main process maps keys
 * itself in `before-input-event`. Pure so it can be table-tested.
 */

/** Zoom step per keypress (Chromium zoom level; 0.5 ≈ ±10 %). */
const ZOOM_STEP = 0.5;

/**
 * @typedef {"zoom-in" | "zoom-out" | "zoom-reset" | "reload" | "fullscreen" | "devtools"} ShellShortcut
 */

/**
 * @param {{ type: string, key: string, control?: boolean, meta?: boolean, alt?: boolean }} input
 * @param {{ allowDevTools?: boolean }} [options]
 * @returns {ShellShortcut | null}
 */
function shortcutFor(input, options = {}) {
  if (!input || input.type !== "keyDown" || typeof input.key !== "string") return null;
  if (input.alt) return null;
  const mod = Boolean(input.control || input.meta);
  const key = input.key;
  if (mod && (key === "=" || key === "+")) return "zoom-in";
  if (mod && (key === "-" || key === "_")) return "zoom-out";
  if (mod && key === "0") return "zoom-reset";
  if (key === "F5" || (mod && key.toLowerCase() === "r")) return "reload";
  if (key === "F11") return "fullscreen";
  if (options.allowDevTools && key === "F12") return "devtools";
  return null;
}

module.exports = { ZOOM_STEP, shortcutFor };
