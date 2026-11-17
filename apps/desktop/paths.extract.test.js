import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ensureRealmExtracted, finalizeRealmExtract } = require("./paths.js");
const execFileAsync = promisify(execFile);

const temps = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roxysu-realm-"));
  temps.push(dir);
  return dir;
}

describe("ensureRealmExtracted", () => {
  test("unpacks the archive off the caller and writes the marker once", async () => {
    const root = tempDir();
    const stage = path.join(root, "stage");
    fs.mkdirSync(path.join(stage, "realm-reader"), { recursive: true });
    fs.writeFileSync(path.join(stage, "realm-reader", "index.js"), "ok\n");
    const archive = path.join(root, "realm-reader.tgz");
    await execFileAsync("tar", ["-czf", archive, "-C", stage, "realm-reader"]);

    const realmDir = path.join(root, "out");
    const paths = {
      realmArchive: archive,
      realmDir,
      realmEntry: path.join(realmDir, "index.js"),
    };
    await ensureRealmExtracted(paths);
    expect(fs.readFileSync(paths.realmEntry, "utf8")).toBe("ok\n");
    const marker = path.join(realmDir, ".roxysu-extracted");
    const written = fs.readFileSync(marker, "utf8");
    await ensureRealmExtracted(paths);
    expect(fs.readFileSync(marker, "utf8")).toBe(written);
  });

  test("a failed tar leaves no marker", async () => {
    const root = tempDir();
    const realmDir = path.join(root, "out");
    const paths = {
      realmArchive: path.join(root, "missing.tgz"),
      realmDir,
      realmEntry: path.join(realmDir, "index.js"),
    };
    await expect(ensureRealmExtracted(paths)).rejects.toThrow();
    expect(fs.existsSync(path.join(realmDir, ".roxysu-extracted"))).toBe(false);
  });

  test("flattens a nested realm-reader directory before writing the marker", () => {
    const root = tempDir();
    const realmDir = path.join(root, "out");
    fs.mkdirSync(path.join(realmDir, "realm-reader"), { recursive: true });
    fs.writeFileSync(path.join(realmDir, "realm-reader", "index.js"), "nested\n");
    const paths = {
      realmArchive: path.join(root, "realm-reader.tgz"),
      realmDir,
      realmEntry: path.join(realmDir, "index.js"),
    };
    finalizeRealmExtract(paths);
    expect(fs.readFileSync(paths.realmEntry, "utf8")).toBe("nested\n");
    expect(fs.existsSync(path.join(realmDir, ".roxysu-extracted"))).toBe(true);
  });

  test("does not write the marker when the entry is missing", () => {
    const root = tempDir();
    const realmDir = path.join(root, "out");
    fs.mkdirSync(realmDir, { recursive: true });
    const paths = {
      realmArchive: path.join(root, "realm-reader.tgz"),
      realmDir,
      realmEntry: path.join(realmDir, "index.js"),
    };
    expect(() => finalizeRealmExtract(paths)).toThrow(/did not produce/);
    expect(fs.existsSync(path.join(realmDir, ".roxysu-extracted"))).toBe(false);
  });
});
