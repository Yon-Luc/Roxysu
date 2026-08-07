import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeOsuImportScripts } from "./openInOsu";

describe("writeOsuImportScripts", () => {
  test("writes executable-ish sh and bat that reference archives", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-import-"));
    try {
      const a = path.join(dir, "1 Artist - Title.osz");
      const b = path.join(dir, "2 Other - Song.osz");
      const scripts = writeOsuImportScripts(dir, [a, b]);

      expect(scripts.sh).toBe(path.join(dir, "import-into-osu.sh"));
      expect(scripts.bat).toBe(path.join(dir, "import-into-osu.bat"));

      const sh = readFileSync(scripts.sh, "utf8");
      expect(sh).toContain("#!/usr/bin/env bash");
      expect(sh).toContain("osu!");
      expect(sh).toContain("xdg-open");
      expect(sh).toContain("1 Artist - Title.osz");
      expect(sh).toContain("2 Other - Song.osz");

      const bat = readFileSync(scripts.bat, "utf8");
      expect(bat).toContain("@echo off");
      expect(bat).toContain('start "" "1 Artist - Title.osz"');
      expect(bat).toContain("timeout /t 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("shell-escapes single quotes in filenames", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-import-"));
    try {
      const weird = path.join(dir, "3 It's Fine.osz");
      const { sh } = writeOsuImportScripts(dir, [weird]);
      const body = readFileSync(sh, "utf8");
      expect(body).toContain("3 It'\\''s Fine.osz");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
