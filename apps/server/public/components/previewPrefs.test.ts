import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_PREFS,
  FIELD_WIDTH_DEFAULT,
  loadPrefs,
  nearestKeymode,
  patchManiaPlayfield,
  patchPlayfieldFieldWidth,
  PREFS_KEY,
  resolveManiaScroll,
  resolvePlayfieldFieldWidth,
} from "./previewPrefs";
import { PREVIEW_SCROLL_DEFAULT } from "../lib/paintManiaNotefield";
import { KEYMODES } from "../lib/previewSkin";

const store = new Map<string, string>();

const localStorageMock = {
  getItem(key: string) {
    return store.has(key) ? store.get(key)! : null;
  },
  setItem(key: string, value: string) {
    store.set(key, value);
  },
  removeItem(key: string) {
    store.delete(key);
  },
  clear() {
    store.clear();
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

afterEach(() => {
  store.clear();
});

describe("nearestKeymode", () => {
  test("returns exact keymode when supported", () => {
    expect(nearestKeymode(4)).toBe(4);
    expect(nearestKeymode(7)).toBe(7);
  });

  test("falls back to nearest for unsupported counts", () => {
    expect(nearestKeymode(5)).toBe(4);
    expect(nearestKeymode(1)).toBe(4);
  });
});

describe("loadPrefs migration", () => {
  test("returns defaults when empty", () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  test("migrates legacy flat scroll and fieldWidth onto every slot", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        volume: 0.5,
        scroll: 32,
        fieldWidth: 40,
      }),
    );
    const prefs = loadPrefs();
    expect(prefs.volume).toBe(0.5);
    expect(prefs.playfield.osu.fieldWidth).toBe(40);
    expect(prefs.playfield.taiko.fieldWidth).toBe(40);
    expect(prefs.playfield.fruits.fieldWidth).toBe(40);
    for (const k of KEYMODES) {
      expect(prefs.playfield.mania[k].fieldWidth).toBe(40);
      expect(prefs.playfield.mania[k].scroll).toBe(32);
    }
  });

  test("preserves nested playfield and ignores stale flat fields for filled slots", () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        scroll: 10,
        fieldWidth: 20,
        playfield: {
          osu: { fieldWidth: 70 },
          taiko: { fieldWidth: 60 },
          fruits: { fieldWidth: 50 },
          mania: {
            4: { fieldWidth: 35, scroll: 28 },
            7: { fieldWidth: 45, scroll: 22 },
          },
        },
      }),
    );
    const prefs = loadPrefs();
    expect(prefs.playfield.osu.fieldWidth).toBe(70);
    expect(prefs.playfield.mania[4].fieldWidth).toBe(35);
    expect(prefs.playfield.mania[4].scroll).toBe(28);
    expect(prefs.playfield.mania[7].fieldWidth).toBe(45);
    expect(prefs.playfield.mania[7].scroll).toBe(22);
    // Missing keymodes filled from legacy flat values
    expect(prefs.playfield.mania[6].fieldWidth).toBe(20);
    expect(prefs.playfield.mania[6].scroll).toBe(10);
  });
});

describe("resolve and patch playfield prefs", () => {
  test("resolvePlayfieldFieldWidth is independent per ruleset and keymode", () => {
    let prefs = DEFAULT_PREFS;
    prefs = patchPlayfieldFieldWidth(prefs, "osu", 80);
    prefs = patchPlayfieldFieldWidth(prefs, "mania", 30, 4);
    prefs = patchPlayfieldFieldWidth(prefs, "mania", 55, 7);
    expect(resolvePlayfieldFieldWidth(prefs, "osu")).toBe(80);
    expect(resolvePlayfieldFieldWidth(prefs, "taiko")).toBe(FIELD_WIDTH_DEFAULT);
    expect(resolvePlayfieldFieldWidth(prefs, "mania", 4)).toBe(30);
    expect(resolvePlayfieldFieldWidth(prefs, "mania", 7)).toBe(55);
  });

  test("resolveManiaScroll is independent per keymode", () => {
    let prefs = DEFAULT_PREFS;
    prefs = patchManiaPlayfield(prefs, 4, { scroll: 12 });
    prefs = patchManiaPlayfield(prefs, 7, { scroll: 36 });
    expect(resolveManiaScroll(prefs, 4)).toBe(12);
    expect(resolveManiaScroll(prefs, 7)).toBe(36);
    expect(resolveManiaScroll(prefs, 5)).toBe(12); // nearest → 4
    expect(resolveManiaScroll(prefs, 6)).toBe(PREVIEW_SCROLL_DEFAULT);
  });
});
