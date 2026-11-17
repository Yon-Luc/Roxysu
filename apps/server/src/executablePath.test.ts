import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { assertSafeExecutablePath } from "./executablePath";

describe("assertSafeExecutablePath", () => {
  test("accepts an absolute regular file and a symlink to one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-exec-"));
    const file = path.join(dir, "tosu");
    writeFileSync(file, "");
    expect(assertSafeExecutablePath(file)).toEqual({ ok: true, path: file });
    const link = path.join(dir, "tosu-link");
    symlinkSync(file, link);
    expect(assertSafeExecutablePath(link)).toEqual({ ok: true, path: link });
  });

  test("rejects relative paths, directories, missing files, and NULs", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-exec-"));
    expect(assertSafeExecutablePath("tosu")).toEqual({
      ok: false,
      error: "Executable path must be absolute",
    });
    expect(assertSafeExecutablePath(dir).ok).toBe(false);
    expect(assertSafeExecutablePath(path.join(dir, "missing")).ok).toBe(false);
    expect(assertSafeExecutablePath(`/tmp/a\0b`).ok).toBe(false);
    expect(assertSafeExecutablePath(`${dir}/tosu\n`).ok).toBe(false);
  });
});
