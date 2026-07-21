import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findFlakeRoot,
  resetFfmpegPathCache,
  resolveFfmpegPath,
  resolveNixBinary,
} from "./resolveFfmpegPath";

const originalEnv = process.env.FFMPEG_PATH;
const originalCwd = process.cwd();
const originalWhich = Bun.which;

afterEach(() => {
  resetFfmpegPathCache();
  if (originalEnv === undefined) {
    delete process.env.FFMPEG_PATH;
  } else {
    process.env.FFMPEG_PATH = originalEnv;
  }
  process.chdir(originalCwd);
  Bun.which = originalWhich;
});

describe("findFlakeRoot", () => {
  test("finds flake.nix in a parent directory", () => {
    const root = mkdtempSync(join(tmpdir(), "roxysu-flake-"));
    const nested = join(root, "apps", "server");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, "flake.nix"), "{}");

    expect(findFlakeRoot(nested)).toBe(root);

    rmSync(root, { recursive: true, force: true });
  });

  test("returns null when no flake.nix exists", () => {
    const root = mkdtempSync(join(tmpdir(), "roxysu-noflake-"));
    const nested = join(root, "deep");
    mkdirSync(nested, { recursive: true });

    expect(findFlakeRoot(nested)).toBeNull();

    rmSync(root, { recursive: true, force: true });
  });
});

describe("resolveFfmpegPath", () => {
  test("prefers FFMPEG_PATH over PATH lookup", async () => {
    process.env.FFMPEG_PATH = "/custom/ffmpeg";
    Bun.which = () => "/usr/bin/ffmpeg";

    await expect(resolveFfmpegPath()).resolves.toBe("/custom/ffmpeg");
  });

  test("uses Bun.which when FFMPEG_PATH is unset", async () => {
    delete process.env.FFMPEG_PATH;
    Bun.which = (cmd) => (cmd === "ffmpeg" ? "/usr/bin/ffmpeg" : null);

    await expect(resolveFfmpegPath()).resolves.toBe("/usr/bin/ffmpeg");
  });

  test("caches the first successful resolution", async () => {
    process.env.FFMPEG_PATH = "/cached/ffmpeg";
    Bun.which = () => {
      throw new Error("should not be called after cache");
    };

    await expect(resolveFfmpegPath()).resolves.toBe("/cached/ffmpeg");
    await expect(resolveFfmpegPath()).resolves.toBe("/cached/ffmpeg");
  });

  test("resolves via repo flake when cwd is outside the repo", async () => {
    delete process.env.FFMPEG_PATH;
    Bun.which = () => null;
    const empty = mkdtempSync(join(tmpdir(), "roxysu-outside-"));
    process.chdir(empty);

    const path = await resolveFfmpegPath();
    expect(path.endsWith("/bin/ffmpeg")).toBe(true);

    rmSync(empty, { recursive: true, force: true });
  });
});

describe("resolveNixBinary", () => {
  test("uses Bun.which when nix is on PATH", () => {
    Bun.which = (cmd) => (cmd === "nix" ? "/usr/bin/nix" : null);
    expect(resolveNixBinary()).toBe("/usr/bin/nix");
  });
});
