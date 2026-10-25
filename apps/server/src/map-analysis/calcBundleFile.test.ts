import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  CALC_BUNDLE_FILE_FORMAT,
  readShippedCalcBundleFile,
  serializeCalcBundleFileEntry,
  serializeCalcBundleFileHeader,
} from "./calcBundleFile";
import type { CalcBundleEntry } from "./calcBundle";

const ALGORITHMS = new Set(["mania-difficulty", "mania-skill-v1"]);
const VERSION = "9.9.9-test";

const DAN_ENTRY: CalcBundleEntry = {
  beatmapHash: "ab".repeat(32),
  onlineBeatmapId: 12345,
  algorithm: "mania-difficulty",
  sunnyStar: 4.5,
  lnRatio: 0.3,
  columnCount: 7,
  estDiff: "Regular 7 mid",
};

const PATTERN_ENTRY: CalcBundleEntry = {
  beatmapHash: "cd".repeat(32),
  onlineBeatmapId: null,
  algorithm: "mania-skill-v1",
  columnCount: 7,
  dominantPattern: "speed",
  secondaryPattern: "jack",
  shapePattern: null,
  secondaryShape: null,
  confidence: 0.2,
};

function headerLine(entryCount: number, roxysuVersion = VERSION): string {
  return serializeCalcBundleFileHeader({
    format: CALC_BUNDLE_FILE_FORMAT,
    roxysuVersion,
    algorithms: [...ALGORITHMS],
    entryCount,
  });
}

const tmpBase = mkdtempSync(path.join(tmpdir(), "roxysu-calcbundlefile-"));
let fixtureSeq = 0;

/** Write gz text to a temp fixture file and hand back its path. */
function fixture(text: string): string {
  const p = path.join(tmpBase, `bundle-${fixtureSeq++}.ndjson.gz`);
  writeFileSync(p, gzipSync(Buffer.from(text, "utf8")));
  return p;
}

function read(
  p: string,
  expectedVersion = VERSION,
): ReturnType<typeof readShippedCalcBundleFile> {
  return readShippedCalcBundleFile(p, expectedVersion, ALGORITHMS);
}

afterAll(() => {
  rmSync(tmpBase, { recursive: true, force: true });
});

describe("serializeCalcBundleFileEntry", () => {
  test("drops onlineBeatmapId and null columns", () => {
    const parsed = JSON.parse(serializeCalcBundleFileEntry(PATTERN_ENTRY));
    expect(parsed.beatmapHash).toBe("cd".repeat(32));
    expect(parsed.dominantPattern).toBe("speed");
    expect("onlineBeatmapId" in parsed).toBe(false);
    expect("shapePattern" in parsed).toBe(false);
    expect("confidence" in parsed).toBe(true);
  });
});

describe("readShippedCalcBundleFile", () => {
  test("missing path → not ok", () => {
    const result = read("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no file path");
  });

  test("missing file → not ok", () => {
    const result = read("/nonexistent/calc-bundle.ndjson.gz");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("unreadable");
  });

  test("not a gzip/truncated file → malformed, not ok", () => {
    const p = fixture("this is not gzip");
    const result = read(p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a gzip|malformed/);
  });

  test("roundtrip parses entries, keeping only file-borne columns", () => {
    const entries: CalcBundleEntry[] = [DAN_ENTRY, PATTERN_ENTRY];
    const lines = entries.map(serializeCalcBundleFileEntry);
    const text = buildText(headerLine(lines.length), ...lines);
    const result = read(fixture(text));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.header.entryCount).toBe(2);
      expect(result.header.roxysuVersion).toBe(VERSION);
      expect(result.entries).toEqual(lines.map((l) => JSON.parse(l)));
    }
  });

  test("gzip-decompressed text is the expected NDJSON", () => {
    const text = buildText(
      headerLine(1),
      serializeCalcBundleFileEntry(DAN_ENTRY),
    );
    const gz = gzipSync(Buffer.from(text, "utf8"));
    expect(gunzipSync(gz).toString("utf8")).toBe(text);
  });

  test("version mismatch → not ok naming both versions", () => {
    const text = buildText(
      headerLine(1),
      serializeCalcBundleFileEntry(DAN_ENTRY),
    );
    const result = read(fixture(text), "0.1.99");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain(VERSION);
      expect(result.reason).toContain("0.1.99");
    }
  });

  test("wrong format token → not ok", () => {
    const text = buildText(
      JSON.stringify({
        format: "something-else",
        roxysuVersion: VERSION,
        algorithms: [...ALGORITHMS],
        entryCount: 0,
      }),
    );
    const result = read(fixture(text));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("format");
  });

  test("invalid entry line → not ok naming the line", () => {
    const text = buildText(headerLine(1), "{not json");
    const result = read(fixture(text));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("entry line 2");
  });

  test("unknown algorithm → not ok", () => {
    const rogue: CalcBundleEntry = { ...DAN_ENTRY, algorithm: "sunny" };
    const text = buildText(
      headerLine(1),
      serializeCalcBundleFileEntry(rogue),
    );
    const result = read(fixture(text));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("algorithm");
  });

  test("blank lines and trailing newline are tolerated", () => {
    const text =
      headerLine(1) +
      "\n\n" +
      serializeCalcBundleFileEntry(DAN_ENTRY) +
      "\n\n";
    const result = read(fixture(text));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries.length).toBe(1);
  });
});

function buildText(header: string, ...entryLines: string[]): string {
  return [header, ...entryLines].join("\n") + "\n";
}
