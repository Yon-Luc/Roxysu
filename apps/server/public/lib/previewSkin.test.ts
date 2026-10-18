import { describe, expect, test } from "bun:test";
import {
  HIT_POSITION_DEFAULT,
  KEYMODES,
  LANE_COVER_DEFAULT,
  nearestKeymode,
  parsePreviewSkinJson,
  resolveKeymodeSkin,
} from "./previewSkin";

describe("parsePreviewSkinJson migration", () => {
  test("copies legacy root hitPosition/laneCover onto every keymode", () => {
    const skin = parsePreviewSkinJson(
      JSON.stringify({
        hitPosition: 0.7,
        laneCover: 0.2,
        keymodes: {
          4: { shape: "flat", columns: [] },
          7: { shape: "arrow", columns: [] },
        },
      }),
    );
    for (const k of KEYMODES) {
      expect(skin.keymodes[k].hitPosition).toBe(0.7);
      expect(skin.keymodes[k].laneCover).toBe(0.2);
    }
    expect(skin.keymodes[4].shape).toBe("flat");
    expect(skin.keymodes[7].shape).toBe("arrow");
    expect("hitPosition" in skin).toBe(false);
  });

  test("preserves per-keymode hit/cover when already nested", () => {
    const skin = parsePreviewSkinJson(
      JSON.stringify({
        hitPosition: 0.9,
        laneCover: 0.1,
        keymodes: {
          4: { hitPosition: 0.6, laneCover: 0.05, columns: [] },
          7: { hitPosition: 0.85, laneCover: 0.3, columns: [] },
        },
      }),
    );
    expect(skin.keymodes[4].hitPosition).toBe(0.6);
    expect(skin.keymodes[4].laneCover).toBe(0.05);
    expect(skin.keymodes[7].hitPosition).toBe(0.85);
    expect(skin.keymodes[7].laneCover).toBe(0.3);
    // Missing keymodes inherit legacy root
    expect(skin.keymodes[6].hitPosition).toBe(0.9);
    expect(skin.keymodes[6].laneCover).toBe(0.1);
  });

  test("defaults when empty", () => {
    const skin = parsePreviewSkinJson(null);
    for (const k of KEYMODES) {
      expect(skin.keymodes[k].hitPosition).toBe(HIT_POSITION_DEFAULT);
      expect(skin.keymodes[k].laneCover).toBe(LANE_COVER_DEFAULT);
    }
  });
});

describe("resolveKeymodeSkin playfield fields", () => {
  test("carries hit/cover from nearest keymode for unsupported counts", () => {
    const base = parsePreviewSkinJson(
      JSON.stringify({
        keymodes: {
          4: { hitPosition: 0.65, laneCover: 0.15, columns: [] },
          7: { hitPosition: 0.9, laneCover: 0.4, columns: [] },
        },
      }),
    );
    const resolved = resolveKeymodeSkin(base, 5);
    expect(nearestKeymode(5)).toBe(4);
    expect(resolved.hitPosition).toBe(0.65);
    expect(resolved.laneCover).toBe(0.15);
    expect(resolved.columns).toHaveLength(5);
  });
});
