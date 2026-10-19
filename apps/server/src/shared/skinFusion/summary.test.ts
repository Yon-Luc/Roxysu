import { describe, expect, test } from "bun:test";
import { summarizeSkin } from "./summary";

describe("summarizeSkin", () => {
  test("reports assets, layout, rulesets and key counts", () => {
    const ini = new TextEncoder().encode("[Mania]\nKeys: 7\n[Mania]\nKeys: 4\n");
    const s = summarizeSkin(
      ["skin.ini", "hitcircle.png", "taiko-bar-left.png", "MainHUDComponents.json", "7k\\a.png"],
      ini,
    );
    expect(s).toEqual({
      hasAssets: true,
      hasLayout: true,
      rulesets: ["osu", "taiko"],
      keyCounts: [4, 7],
    });
  });

  test("a layout-only skin has no assets", () => {
    const s = summarizeSkin(["skin.ini", "skininfo.json", "SongSelect.json"]);
    expect(s.hasAssets).toBe(false);
    expect(s.hasLayout).toBe(true);
    expect(s.keyCounts).toEqual([]);
  });
});
