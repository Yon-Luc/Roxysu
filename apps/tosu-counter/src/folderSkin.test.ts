import { describe, expect, test } from "bun:test";
import { validateSkinPack } from "./folderSkin";

const layout = {
  name: "Test skin",
  hitPositionPx: 450,
  columnWidth: [100, 100],
  columnSpacing: [2],
  columnLineWidth: [1],
};

describe("validateSkinPack", () => {
  test("accepts valid sprites and layouts, fills defaults", () => {
    const pack = validateSkinPack({
      name: "My skin",
      layouts: { "4": layout },
      sprites: {
        "4:notes:0": "data:image/png;base64,x",
        "4:stageLeft": "stage.png",
      },
    });
    expect(pack).not.toBeNull();
    expect(pack!.name).toBe("My skin");
    expect(pack!.layouts["4"]).toEqual(layout);
    expect(pack!.sprites.map(([k]) => k)).toEqual(["4:notes:0", "4:stageLeft"]);
  });

  test("rejects packs without sprites", () => {
    expect(validateSkinPack({ name: "x" })).toBeNull();
    expect(validateSkinPack({ sprites: {} })).toBeNull();
    expect(validateSkinPack(null)).toBeNull();
    expect(validateSkinPack("nope")).toBeNull();
  });

  test("filters unknown keymodes / kinds / bad columns", () => {
    const pack = validateSkinPack({
      sprites: {
        "5:notes:0": "a.png", // unsupported keymode
        "4:cursor:0": "b.png", // unknown kind
        "4:notes:9": "c.png", // column out of range
        "4:keysDown:3": "d.png",
      },
    });
    expect(pack!.sprites.map(([k]) => k)).toEqual(["4:keysDown:3"]);
    expect(pack!.layouts).toEqual({});
  });

  test("drops layouts missing required numeric fields", () => {
    const pack = validateSkinPack({
      layouts: {
        "4": { hitPositionPx: "nope" },
        "7": { ...layout, columnWidth: [] },
      },
      sprites: { "4:notes:0": "x.png" },
    });
    expect(pack!.layouts["4"]).toBeUndefined();
    expect(pack!.layouts["7"]).toBeUndefined();
  });
});
