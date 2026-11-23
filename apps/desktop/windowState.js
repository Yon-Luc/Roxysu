"use strict";

/**
 * Pure window-state helpers (DD-8, DD-9 zoom). The main process reads and
 * writes `window-state.json` in userData; everything here is testable
 * without Electron.
 */

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 600;
/** Zoom levels (Chromium steps: 0 = 100 %, each 1.0 ≈ ×1.2). */
const MIN_ZOOM_LEVEL = -3;
const MAX_ZOOM_LEVEL = 5;

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ workArea: Rect }} DisplayLike
 * @typedef {{ width: number, height: number, x?: number, y?: number, maximized: boolean, zoomLevel: number }} WindowState
 */

/** @param {unknown} n */
function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** @param {number} level */
function clampZoomLevel(level) {
  if (!finite(level)) return 0;
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, level));
}

/**
 * True when enough of the window's title area would be on a connected
 * display that the user can grab it (a monitor may have been unplugged).
 * @param {Rect} bounds
 * @param {DisplayLike[]} displays
 */
function isRestorable(bounds, displays) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(finite)) return false;
  return displays.some(({ workArea: a }) => {
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    // The top 40 px (title bar) must start inside the work area vertically.
    const topInside = bounds.y >= a.y - 10 && bounds.y < a.y + a.height - 40;
    return overlapX >= 100 && topInside;
  });
}

/**
 * Turn a parsed window-state.json (any shape) into options for
 * `new BrowserWindow`. Unknown or corrupt input yields the defaults; a size
 * larger than every work area is shrunk to the largest one; a position that
 * is no longer on screen is dropped (the OS centers the window).
 * @param {unknown} raw
 * @param {DisplayLike[]} displays
 * @returns {WindowState}
 */
function sanitizeWindowState(raw, displays) {
  const r = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const maxW = Math.max(MIN_WINDOW_WIDTH, ...displays.map((d) => d.workArea.width));
  const maxH = Math.max(MIN_WINDOW_HEIGHT, ...displays.map((d) => d.workArea.height));
  const width = finite(r.width)
    ? Math.round(Math.min(maxW, Math.max(MIN_WINDOW_WIDTH, /** @type {number} */ (r.width))))
    : DEFAULT_WINDOW_WIDTH;
  const height = finite(r.height)
    ? Math.round(Math.min(maxH, Math.max(MIN_WINDOW_HEIGHT, /** @type {number} */ (r.height))))
    : DEFAULT_WINDOW_HEIGHT;
  /** @type {WindowState} */
  const state = {
    width,
    height,
    maximized: r.maximized === true,
    zoomLevel: clampZoomLevel(/** @type {number} */ (r.zoomLevel)),
  };
  if (finite(r.x) && finite(r.y)) {
    const rect = { x: Math.round(/** @type {number} */ (r.x)), y: Math.round(/** @type {number} */ (r.y)), width, height };
    if (isRestorable(rect, displays)) {
      state.x = rect.x;
      state.y = rect.y;
    }
  }
  return state;
}

/**
 * @param {Rect} normalBounds From BrowserWindow#getNormalBounds().
 * @param {boolean} maximized
 * @param {number} zoomLevel
 */
function serializeWindowState(normalBounds, maximized, zoomLevel) {
  return {
    x: normalBounds.x,
    y: normalBounds.y,
    width: normalBounds.width,
    height: normalBounds.height,
    maximized,
    zoomLevel: clampZoomLevel(zoomLevel),
  };
}

module.exports = {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MAX_ZOOM_LEVEL,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  MIN_ZOOM_LEVEL,
  clampZoomLevel,
  isRestorable,
  sanitizeWindowState,
  serializeWindowState,
};
