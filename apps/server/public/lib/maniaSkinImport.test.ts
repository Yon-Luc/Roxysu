import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import {
  draftFromArchiveBytes,
  findSkinIniPath,
  unzipSkinArchive,
} from "./maniaSkinImport";

describe("unzipSkinArchive", () => {
  test("indexes files and finds nested skin.ini", () => {
    const archive = zipSync({
      "Cool Skin/skin.ini": new TextEncoder().encode("[General]\nName: Cool\n"),
      "Cool Skin/mania-note1.png": new Uint8Array([1, 2, 3]),
    });
    const files = unzipSkinArchive(archive);
    expect(findSkinIniPath(files)).toBe("Cool Skin/skin.ini");
    expect(files.get("Cool Skin/mania-note1.png")?.length).toBe(3);
  });

  test("prefers the shortest skin.ini path", () => {
    const archive = zipSync({
      "skin.ini": new TextEncoder().encode("[General]\nName: Root\n"),
      "extra/skin.ini": new TextEncoder().encode("[General]\nName: Nested\n"),
    });
    const files = unzipSkinArchive(archive);
    expect(findSkinIniPath(files)).toBe("skin.ini");
  });
});

describe("draftFromArchiveBytes", () => {
  test("builds a draft from a Realm-style archive zip", async () => {
    const archive = zipSync({
      "skin.ini": new TextEncoder().encode(
        "[General]\nName: FromGame\n\n[Mania]\nKeys: 4\n",
      ),
    });
    const draft = await draftFromArchiveBytes(archive, "Fallback");
    expect(draft.name).toBe("FromGame");
    expect(draft.definedKeys).toContain(4);
    expect(draft.packs[4]).toBeDefined();
  });
});
