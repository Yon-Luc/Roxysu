import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_MAX_LOG_BYTES,
  fileSizeOrZero,
  rotateIfLarger,
  shouldRotate,
} = require("./logRotation.js");

/** @type {string[]} */
const tempDirs = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roxysu-log-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("shouldRotate", () => {
  test("a file below the cap is left alone", () => {
    expect(shouldRotate(1024, 4096)).toBe(false);
  });

  test("a file exactly at the cap is left alone", () => {
    expect(shouldRotate(4096, 4096)).toBe(false);
  });

  test("a file above the cap rotates", () => {
    expect(shouldRotate(4097, 4096)).toBe(true);
  });

  test("a non-positive or non-finite cap disables rotation", () => {
    expect(shouldRotate(10_000, 0)).toBe(false);
    expect(shouldRotate(10_000, -1)).toBe(false);
    expect(shouldRotate(10_000, Number.NaN)).toBe(false);
    expect(shouldRotate(Number.NaN, 1024)).toBe(false);
  });

  test("the default cap is 10 MiB", () => {
    expect(DEFAULT_MAX_LOG_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("rotateIfLarger", () => {
  test("does not touch a file below the cap", () => {
    const dir = tempDir();
    const file = path.join(dir, "desktop.log");
    fs.writeFileSync(file, "small");
    expect(rotateIfLarger(file, 1024)).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("small");
    expect(fs.existsSync(`${file}.1`)).toBe(false);
  });

  test("rotates a file above the cap into <path>.1", () => {
    const dir = tempDir();
    const file = path.join(dir, "desktop.log");
    fs.writeFileSync(file, "x".repeat(2048));
    expect(rotateIfLarger(file, 1024)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(`${file}.1`, "utf8").length).toBe(2048);
  });

  test("a missing file is not an error and rotates nothing", () => {
    const dir = tempDir();
    const file = path.join(dir, "never-written.log");
    expect(() => rotateIfLarger(file, 1024)).not.toThrow();
    expect(rotateIfLarger(file, 1024)).toBe(false);
    expect(fs.existsSync(`${file}.1`)).toBe(false);
  });

  test("an existing .1 backup is replaced", () => {
    const dir = tempDir();
    const file = path.join(dir, "server.log");
    fs.writeFileSync(file, "new".repeat(1024));
    fs.writeFileSync(`${file}.1`, "old");
    expect(rotateIfLarger(file, 1024)).toBe(true);
    const backup = fs.readFileSync(`${file}.1`, "utf8");
    expect(backup).toBe("new".repeat(1024));
  });

  test("a rotation failure is reported, never thrown", () => {
    const dir = tempDir();
    const file = path.join(dir, "overlay.log");
    fs.writeFileSync(file, "x".repeat(4096));
    /** @type {unknown[]} */
    const errors = [];
    const rotated = rotateIfLarger(file, 1024, {
      rename: () => {
        throw new Error("EBUSY");
      },
      onError: (err) => errors.push(err),
    });
    expect(rotated).toBe(false);
    expect(errors.length).toBe(1);
    expect(String(errors[0])).toContain("EBUSY");
    expect(fs.readFileSync(file, "utf8").length).toBe(4096);
  });

  test("an unreadable stat is treated as nothing to rotate", () => {
    const rotated = rotateIfLarger("/logs/desktop.log", 1024, {
      stat: () => {
        throw new Error("ENOENT");
      },
    });
    expect(rotated).toBe(false);
  });
});

describe("fileSizeOrZero", () => {
  test("returns the size of an existing file", () => {
    const dir = tempDir();
    const file = path.join(dir, "a.log");
    fs.writeFileSync(file, "12345");
    expect(fileSizeOrZero(file)).toBe(5);
  });

  test("returns 0 for a missing file", () => {
    const dir = tempDir();
    expect(fileSizeOrZero(path.join(dir, "missing.log"))).toBe(0);
  });
});
