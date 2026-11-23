import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { assertSafeExecutablePath } from "./executablePath";

const posix = process.platform !== "win32";

function tempBase(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function writeExecutable(file: string, mode = 0o755): string {
  writeFileSync(file, "");
  chmodSync(file, mode);
  return file;
}

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

describe("assertSafeExecutablePath allowedRoots", () => {
  test("accepts a regular file under the allowed root", () => {
    const base = tempBase("roxysu-exec-root-");
    const root = path.join(base, "calculators");
    mkdirSync(root, { recursive: true });
    const file = writeExecutable(path.join(root, "mania-rating-calc"));
    expect(
      assertSafeExecutablePath(file, { allowedRoots: [root] }),
    ).toEqual({ ok: true, path: file });
  });

  test("rejects a file outside every allowed root", () => {
    const base = tempBase("roxysu-exec-root-");
    const root = path.join(base, "calculators");
    const other = path.join(base, "elsewhere");
    mkdirSync(root, { recursive: true });
    mkdirSync(other, { recursive: true });
    const file = writeExecutable(path.join(other, "mania-rating-calc"));
    expect(
      assertSafeExecutablePath(file, { allowedRoots: [root] }),
    ).toEqual({
      ok: false,
      error: "Executable path is not inside an allowed directory",
    });
  });

  test("rejects .. traversal out of the allowed root", () => {
    const base = tempBase("roxysu-exec-root-");
    const root = path.join(base, "calculators");
    const other = path.join(base, "elsewhere");
    mkdirSync(root, { recursive: true });
    mkdirSync(other, { recursive: true });
    writeExecutable(path.join(other, "mania-rating-calc"));
    const traversal = path.join(root, "..", "elsewhere", "mania-rating-calc");
    expect(
      assertSafeExecutablePath(traversal, { allowedRoots: [root] }).ok,
    ).toBe(false);
  });

  test("keeps a symlink inside the root and rejects one pointing outside", () => {
    const base = tempBase("roxysu-exec-root-");
    const root = path.join(base, "calculators");
    const other = path.join(base, "elsewhere");
    mkdirSync(root, { recursive: true });
    mkdirSync(other, { recursive: true });
    const inside = writeExecutable(path.join(root, "real"));
    const insideLink = path.join(root, "inside-link");
    symlinkSync(inside, insideLink);
    expect(
      assertSafeExecutablePath(insideLink, { allowedRoots: [root] }),
    ).toEqual({ ok: true, path: insideLink });

    const outside = writeExecutable(path.join(other, "real"));
    const outsideLink = path.join(root, "outside-link");
    symlinkSync(outside, outsideLink);
    expect(
      assertSafeExecutablePath(outsideLink, { allowedRoots: [root] }),
    ).toEqual({
      ok: false,
      error: "Executable path is not inside an allowed directory",
    });
  });

  test("an empty allowlist rejects every file", () => {
    const base = tempBase("roxysu-exec-root-");
    const file = writeExecutable(path.join(base, "binary"));
    expect(assertSafeExecutablePath(file, { allowedRoots: [] }).ok).toBe(false);
  });
});

describe("assertSafeExecutablePath hardened tosu checks", () => {
  test("requireExecutable rejects a file without an execute bit", () => {
    if (!posix) return;
    const base = tempBase("roxysu-exec-xok-");
    const file = writeExecutable(path.join(base, "tosu"), 0o644);
    const checked = assertSafeExecutablePath(file, { requireExecutable: true });
    expect(checked).toEqual({
      ok: false,
      error: "Executable is not runnable (missing execute permission)",
    });
    chmodSync(file, 0o755);
    expect(assertSafeExecutablePath(file, { requireExecutable: true })).toEqual({
      ok: true,
      path: file,
    });
  });

  test("rejects world-writable files on POSIX", () => {
    if (!posix) return;
    const base = tempBase("roxysu-exec-ww-");
    const file = writeExecutable(path.join(base, "tosu"), 0o777);
    expect(
      assertSafeExecutablePath(file, { rejectWorldWritable: true }),
    ).toEqual({
      ok: false,
      error: "Executable must not be writable by every user",
    });
    chmodSync(file, 0o755);
    expect(
      assertSafeExecutablePath(file, { rejectWorldWritable: true }).ok,
    ).toBe(true);
  });

  test("rejects paths inside os.tmpdir()", () => {
    const base = tempBase("roxysu-exec-tmp-");
    const file = writeExecutable(path.join(base, "tosu"));
    expect(assertSafeExecutablePath(file, { rejectTempDir: true })).toEqual({
      ok: false,
      error: "Executable must not live in a temporary directory",
    });
  });
});
