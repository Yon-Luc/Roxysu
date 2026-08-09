import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BEATMAPS_DOWNLOAD_DIR_ENV } from "./downloadDir";
import {
  getMirrorBatchJobState,
  resetMirrorBatchJobForTests,
} from "./batchJob";

describe("getMirrorBatchJobState restart hydration", () => {
  const prevDir = process.env[BEATMAPS_DOWNLOAD_DIR_ENV];

  afterEach(() => {
    resetMirrorBatchJobForTests();
    if (prevDir === undefined) delete process.env[BEATMAPS_DOWNLOAD_DIR_ENV];
    else process.env[BEATMAPS_DOWNLOAD_DIR_ENV] = prevDir;
  });

  test("re-discovers leftover .osz after in-memory list is cleared", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-batch-restart-"));
    process.env[BEATMAPS_DOWNLOAD_DIR_ENV] = dir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "1 Artist - Title.osz"), "osz");
    writeFileSync(path.join(dir, "2 Other - Song.osz"), "osz");

    resetMirrorBatchJobForTests();
    const state = getMirrorBatchJobState();

    expect(state.savedForImport).toBe(2);
    expect(state.importScriptSh).toBeTruthy();
  });

  test("ignores archives already marked sent to osu!", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-batch-sent-"));
    process.env[BEATMAPS_DOWNLOAD_DIR_ENV] = dir;
    mkdirSync(dir, { recursive: true });
    const a = path.join(dir, "1 Artist - Title.osz");
    const b = path.join(dir, "2 Other - Song.osz");
    writeFileSync(a, "osz");
    writeFileSync(b, "osz");
    writeFileSync(
      path.join(dir, ".roxysu-sent-to-osu.json"),
      JSON.stringify({ paths: [a], updatedAt: new Date().toISOString() }),
    );

    resetMirrorBatchJobForTests();
    expect(getMirrorBatchJobState().savedForImport).toBe(1);
  });
});
