import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { stageImageInsideSource } from "./stageImage";

describe("stageImageInsideSource", () => {
  test("returns an image inside the source folder", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bms-stage-"));
    writeFileSync(path.join(root, "stagefile.jpg"), "jpeg");
    expect(stageImageInsideSource(root, "stagefile.jpg")).toBe(
      path.join(root, "stagefile.jpg"),
    );
  });

  test("rejects a path that leaves the source folder", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bms-stage-"));
    const outside = mkdtempSync(path.join(tmpdir(), "bms-outside-"));
    writeFileSync(path.join(outside, "secret.jpg"), "nope");
    expect(stageImageInsideSource(root, path.join("..", path.basename(outside), "secret.jpg"))).toBeNull();
  });

  test("rejects a symlink that points outside the source folder", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bms-stage-"));
    const outside = mkdtempSync(path.join(tmpdir(), "bms-outside-"));
    writeFileSync(path.join(outside, "secret.jpg"), "nope");
    symlinkSync(path.join(outside, "secret.jpg"), path.join(root, "stage.jpg"));
    mkdirSync(root, { recursive: true });
    expect(stageImageInsideSource(root, "stage.jpg")).toBeNull();
  });
});
