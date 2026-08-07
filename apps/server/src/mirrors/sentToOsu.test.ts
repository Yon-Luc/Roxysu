import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  filterNotSentToOsu,
  isSentToOsu,
  recordSentToOsu,
} from "./sentToOsu";

describe("sentToOsu", () => {
  test("records sent archives and filters them out", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-sent-"));
    try {
      const a = path.join(dir, "1 Artist - Title.osz");
      const b = path.join(dir, "2 Other - Song.osz");
      writeFileSync(a, "fake");
      writeFileSync(b, "fake");

      expect(isSentToOsu(a, dir)).toBe(false);
      recordSentToOsu([a], dir);
      expect(isSentToOsu(a, dir)).toBe(true);
      expect(isSentToOsu(b, dir)).toBe(false);
      expect(filterNotSentToOsu([a, b], dir)).toEqual([b]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
