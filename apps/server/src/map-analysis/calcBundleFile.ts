import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { CalcBundleEntry } from "./calcBundle";

/**
 * Shipped calc bundle file: a gzipped NDJSON release artifact of Hub calc
 * bundle rows.Packaged installs read it at boot instead of pulling the Hub.
 *
 * Line 1 is a header, every following line is one entry. The file is
 * version-keyed by construction (`roxysuVersion` header must equal
 * `APP_VERSION` at boot) and contains only the columns the client applies —
 * no `onlineBeatmapId` (matching is by beatmap content hash).
 */
export const CALC_BUNDLE_FILE_FORMAT = "roxysu-calc-bundle";

export type CalcBundleFileHeader = {
  format: string;
  roxysuVersion: string;
  algorithms: string[];
  entryCount: number;
};

export function serializeCalcBundleFileHeader(
  header: CalcBundleFileHeader,
): string {
  return JSON.stringify(header);
}

/**
 * Export entry → file line. Drops advisory metadata (`onlineBeatmapId`) and
 * null-valued columns so the shipped file only carries what `applyCalcBundle`
 * writes.
 */
export function serializeCalcBundleFileEntry(
  entry: CalcBundleEntry,
): string {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === "onlineBeatmapId") continue;
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return JSON.stringify(out);
}

export type ShippedCalcBundleRead =
  | { ok: true; header: CalcBundleFileHeader; entries: CalcBundleEntry[] }
  | { ok: false; reason: string };

function parseHeaderLine(line: string): CalcBundleFileHeader {
  let header: unknown;
  try {
    header = JSON.parse(line);
  } catch {
    throw new Error("header is not JSON");
  }
  const h = header as Partial<CalcBundleFileHeader> | null;
  if (!h || typeof h !== "object") throw new Error("header is not an object");
  if (h.format !== CALC_BUNDLE_FILE_FORMAT) {
    throw new Error(`unknown format ${JSON.stringify(h.format)}`);
  }
  if (typeof h.roxysuVersion !== "string" || !h.roxysuVersion) {
    throw new Error("header has no roxysuVersion");
  }
  if (
    !Array.isArray(h.algorithms) ||
    h.algorithms.length === 0 ||
    !h.algorithms.every((a) => typeof a === "string")
  ) {
    throw new Error("header has no algorithms");
  }
  if (typeof h.entryCount !== "number" || h.entryCount < 0) {
    throw new Error("header has no entryCount");
  }
  return {
    format: h.format,
    roxysuVersion: h.roxysuVersion,
    algorithms: h.algorithms,
    entryCount: h.entryCount,
  };
}

function parseEntryLine(line: string, allowedAlgorithms: Set<string>) {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new Error("entry is not JSON");
  }
  const entry = raw as Partial<CalcBundleEntry> | null;
  if (!entry || typeof entry !== "object")
    throw new Error("entry is not an object");
  if (typeof entry.beatmapHash !== "string" || !entry.beatmapHash)
    throw new Error("entry has no beatmapHash");
  if (typeof entry.algorithm !== "string" || !allowedAlgorithms.has(entry.algorithm))
    throw new Error(`entry has unknown algorithm ${JSON.stringify(entry.algorithm)}`);
  return entry as CalcBundleEntry;
}

/**
 * Read + validate a shipped calc bundle file. Every failure is a distinct
 * reason string; packaged boots only get one immutable shot per version, so
 * all failures are fatal-to-that-boot (no retry network fallback).
 */
export function readShippedCalcBundleFile(
  filePath: string,
  expectedVersion: string,
  allowedAlgorithms: Iterable<string>,
): ShippedCalcBundleRead {
  if (!filePath) {
    return { ok: false, reason: "no file path configured" };
  }
  let raw: Buffer;
  try {
    raw = readFileSyncRaw(filePath);
  } catch (err) {
    return {
      ok: false,
      reason: `unreadable at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let text: string;
  try {
    text = gunzipToString(raw);
  } catch (err) {
    return {
      ok: false,
      reason: `not a gzip NDJSON file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    const lines = text.split("\n");
    const fail = (reason: string): ShippedCalcBundleRead => ({
      ok: false,
      reason: `malformed at ${filePath}: ${reason}`,
    });
    let cursor = 0;
    while (lines[cursor] !== undefined && lines[cursor].trim() === "") cursor++;
    if (lines[cursor] === undefined) return fail("file is empty");

    let header: CalcBundleFileHeader;
    try {
      header = parseHeaderLine(lines[cursor]);
    } catch (err) {
      return fail(`header: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (header.roxysuVersion !== expectedVersion) {
      return {
        ok: false,
        reason: `version mismatch: file is for ${header.roxysuVersion}, app is ${expectedVersion}`,
      };
    }

    const entries: CalcBundleEntry[] = [];
    const allowed = new Set(allowedAlgorithms);
    for (let i = cursor + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      try {
        entries.push(parseEntryLine(line, allowed));
      } catch (err) {
        return fail(`entry line ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { ok: true, header, entries };
  } catch (err) {
    return {
      ok: false,
      reason: `malformed calc bundle file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function readFileSyncRaw(filePath: string): Buffer {
  return readFileSync(filePath);
}

function gunzipToString(raw: Buffer): string {
  return gunzipSync(raw).toString("utf8");
}
