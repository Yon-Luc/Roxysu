import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { findSkinIniPath, unzipSkinArchive } from "./maniaSkinImport";

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
