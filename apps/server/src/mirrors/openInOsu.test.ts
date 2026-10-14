import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { IMPORT_QUEUE_FILENAME, writeOsuImportScripts } from "./openInOsu";

describe("writeOsuImportScripts", () => {
  test("writes fixed scripts that loop a queue file, not per-map lines", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-import-"));
    try {
      const a = path.join(dir, "1 Artist - Title.osz");
      const b = path.join(dir, "2 Other - Song.osz");
      const scripts = writeOsuImportScripts(dir, [a, b]);

      expect(scripts.sh).toBe(path.join(dir, "import-into-osu.sh"));
      expect(scripts.bat).toBe(path.join(dir, "import-into-osu.bat"));
      expect(scripts.queue).toBe(path.join(dir, IMPORT_QUEUE_FILENAME));

      const queue = readFileSync(scripts.queue, "utf8");
      expect(queue).toBe("1 Artist - Title.osz\n2 Other - Song.osz\n");

      const sh = readFileSync(scripts.sh, "utf8");
      expect(sh).toContain("#!/usr/bin/env bash");
      expect(sh).toContain("osu!");
      expect(sh).toContain("xdg-open");
      expect(sh).toContain(IMPORT_QUEUE_FILENAME);
      expect(sh).toContain('while IFS= read -r f');
      // Paths live in the queue — not duplicated as open_one lines.
      expect(sh).not.toContain("open_one '1 Artist - Title.osz'");
      expect(sh).not.toContain("open_one '2 Other - Song.osz'");

      const bat = readFileSync(scripts.bat, "utf8");
      expect(bat).toContain("@echo off");
      expect(bat).toContain(IMPORT_QUEUE_FILENAME);
      expect(bat).toContain('for /f "usebackq delims=" %%f in ("%QUEUE%")');
      expect(bat).toContain("timeout /t 1");
      expect(sh).toContain("sleep 0.25");
      expect(bat).not.toContain('start "" "1 Artist - Title.osz"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("queue keeps raw filenames including quotes; scripts stay fixed-size", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-import-"));
    try {
      const weird = path.join(dir, "3 It's Fine.osz");
      const { sh, queue } = writeOsuImportScripts(dir, [weird]);
      expect(readFileSync(queue, "utf8")).toBe("3 It's Fine.osz\n");
      const body = readFileSync(sh, "utf8");
      // No shell-escaped per-file line — bash opens via quoted "$f" from the queue.
      expect(body).not.toContain("3 It'\\''s Fine.osz");
      expect(body).toContain('open_one "$f"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("script body size does not grow with queue length", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "roxysu-import-"));
    try {
      const few = writeOsuImportScripts(dir, [
        path.join(dir, "1.osz"),
        path.join(dir, "2.osz"),
      ]);
      const shFew = readFileSync(few.sh, "utf8").length;

      const many = Array.from({ length: 200 }, (_, i) =>
        path.join(dir, `${i} Map.osz`),
      );
      const lots = writeOsuImportScripts(dir, many);
      const shLots = readFileSync(lots.sh, "utf8").length;
      expect(shLots).toBe(shFew);
      expect(readFileSync(lots.queue, "utf8").split("\n").filter(Boolean)).toHaveLength(
        200,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
