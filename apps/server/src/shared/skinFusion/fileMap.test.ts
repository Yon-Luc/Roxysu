import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import {
  PathIndex,
  bytesEqual,
  findSkinIniPath,
  normalizeRef,
  rebaseToSkinRoot,
  resolveFirstImage,
  resolveImageRef,
  unzipSkinFiles,
} from "./fileMap";

const b = (...n: number[]) => new Uint8Array(n);

describe("fileMap", () => {
  test("normalizeRef converts backslashes and strips leading slashes", () => {
    expect(normalizeRef("\\7k\\a\\mania-note1")).toBe("7k/a/mania-note1");
  });

  test("unzipSkinFiles drops zip-slip names and empty entries", () => {
    const zip = zipSync({
      "skin.ini": b(1),
      "../evil.png": b(1),
      "ok\\sub.png": b(2),
      "empty.png": new Uint8Array(0),
    });
    expect([...unzipSkinFiles(zip).keys()].sort()).toEqual(["ok/sub.png", "skin.ini"]);
  });

  test("rebaseToSkinRoot strips the wrapping folder and drops outside files", () => {
    const files = new Map([
      ["Cool/skin.ini", b(1)],
      ["Cool/mania-note1.png", b(2)],
      ["other/readme.txt", b(3)],
    ]);
    expect(findSkinIniPath(files)).toBe("Cool/skin.ini");
    expect([...rebaseToSkinRoot(files).keys()].sort()).toEqual(["mania-note1.png", "skin.ini"]);
  });

  test("resolveImageRef is case-insensitive and keeps SD, @2x and frames together", () => {
    const index = new PathIndex(
      new Map([
        ["Mania-Note1.PNG", b(1)],
        ["mania-note1@2x.png", b(2)],
        ["mania-note1-0.png", b(3)],
        ["mania-note1-1.png", b(4)],
        ["mania-note1-3.png", b(5)],
      ]),
    );
    const hit = resolveImageRef(index, "MANIA-note1")!;
    expect(hit.base).toBe("MANIA-note1");
    expect(hit.files.map((f) => f.path).sort()).toEqual([
      "Mania-Note1.PNG",
      "mania-note1-0.png",
      "mania-note1-1.png",
      "mania-note1@2x.png",
    ]);
  });

  test("resolveImageRef accepts a reference with extension and returns null when absent", () => {
    const index = new PathIndex(new Map([["star2.png", b(1)]]));
    expect(resolveImageRef(index, "star2.png")?.base).toBe("star2");
    expect(resolveImageRef(index, "nope")).toBeNull();
  });

  test("resolveFirstImage walks candidates in order", () => {
    const index = new PathIndex(new Map([["fallback.png", b(1)]]));
    expect(resolveFirstImage(index, ["named", "fallback"])?.candidate).toBe("fallback");
  });

  test("bytesEqual", () => {
    expect(bytesEqual(b(1, 2), b(1, 2))).toBe(true);
    expect(bytesEqual(b(1, 2), b(1, 3))).toBe(false);
    expect(bytesEqual(b(1), b(1, 2))).toBe(false);
  });
});
