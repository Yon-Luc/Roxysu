import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MAX_ZOOM_LEVEL,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  clampZoomLevel,
  isRestorable,
  sanitizeWindowState,
  serializeWindowState,
} = require("./windowState.js");

const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
// Second monitor to the left, at a 2.0 scale (DIP coordinates).
const leftHiDpi = { workArea: { x: -1280, y: 0, width: 1280, height: 720 } };

describe("isRestorable", () => {
  test("on the primary display", () => {
    expect(isRestorable({ x: 100, y: 100, width: 1280, height: 800 }, [primary])).toBe(true);
  });

  test("negative coordinates on a monitor to the left", () => {
    expect(isRestorable({ x: -1200, y: 20, width: 1000, height: 600 }, [primary, leftHiDpi])).toBe(true);
  });

  test("that monitor unplugged", () => {
    expect(isRestorable({ x: -1200, y: 20, width: 1000, height: 600 }, [primary])).toBe(false);
  });

  test("title bar above or below every display", () => {
    expect(isRestorable({ x: 100, y: -500, width: 1280, height: 800 }, [primary])).toBe(false);
    expect(isRestorable({ x: 100, y: 1030, width: 1280, height: 800 }, [primary])).toBe(false);
  });

  test("garbage", () => {
    expect(isRestorable({ x: Number.NaN, y: 0, width: 10, height: 10 }, [primary])).toBe(false);
    expect(isRestorable(null, [primary])).toBe(false);
  });
});

describe("sanitizeWindowState", () => {
  test("missing or corrupt file gives the defaults", () => {
    for (const raw of [null, undefined, "x", 42, []]) {
      expect(sanitizeWindowState(raw, [primary])).toEqual({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        maximized: false,
        zoomLevel: 0,
      });
    }
  });

  test("restores size, position, maximized and zoom", () => {
    expect(
      sanitizeWindowState({ x: 50, y: 60, width: 1500, height: 900, maximized: true, zoomLevel: 1 }, [primary]),
    ).toEqual({ x: 50, y: 60, width: 1500, height: 900, maximized: true, zoomLevel: 1 });
  });

  test("an off-screen position is dropped but the size kept", () => {
    const s = sanitizeWindowState({ x: -1200, y: 20, width: 1000, height: 650 }, [primary]);
    expect(s).toEqual({ width: 1000, height: 650, maximized: false, zoomLevel: 0 });
  });

  test("sizes are clamped to the minimum and to the largest work area", () => {
    expect(sanitizeWindowState({ width: 10, height: 10 }, [primary])).toMatchObject({
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
    });
    expect(sanitizeWindowState({ width: 5000, height: 5000 }, [primary])).toMatchObject({
      width: 1920,
      height: 1040,
    });
  });

  test("zoom is clamped", () => {
    expect(sanitizeWindowState({ zoomLevel: 99 }, [primary]).zoomLevel).toBe(MAX_ZOOM_LEVEL);
    expect(clampZoomLevel(Number.NaN)).toBe(0);
  });

  test("round-trips through serializeWindowState", () => {
    const saved = serializeWindowState({ x: 10, y: 20, width: 1400, height: 850 }, false, 0.5);
    expect(sanitizeWindowState(JSON.parse(JSON.stringify(saved)), [primary])).toEqual({
      x: 10,
      y: 20,
      width: 1400,
      height: 850,
      maximized: false,
      zoomLevel: 0.5,
    });
  });
});
