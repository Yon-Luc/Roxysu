import type { HitObject } from "./types.js";

/**
 * Minimal .osu (mania mode) parser: just enough to get hit objects + CircleSize
 * out of a raw .osu file, matching HitObject.Parse / PatternFinder.ParseHitObjects.
 */

export interface ParsedOsuFile {
  circleSize: number;
  hitObjects: HitObject[];
}

function xToColumn(x: number, keyCount: number): number {
  const columnWidth = 512.0 / keyCount;
  const column = Math.floor(x / columnWidth);
  return Math.min(Math.max(column, 0), keyCount - 1);
}

function parseHitObjectLine(line: string, keyCount: number): HitObject | null {
  const parts = line.split(",");
  if (parts.length < 5) return null;

  const x = Number(parts[0]);
  const time = Number(parts[2]);
  const typeFlags = Number(parts[3]);
  if (Number.isNaN(x) || Number.isNaN(time) || Number.isNaN(typeFlags)) return null;

  const column = xToColumn(x, keyCount);
  const isHold = (typeFlags & 128) !== 0;

  let endTime = time;
  if (isHold && parts.length >= 6) {
    const lastPart = parts[5];
    const colonIndex = lastPart.indexOf(":");
    const endTimePart = colonIndex >= 0 ? lastPart.slice(0, colonIndex) : lastPart;
    const parsedEndTime = Number(endTimePart);
    if (!Number.isNaN(parsedEndTime)) endTime = parsedEndTime;
  }

  return {
    time,
    column,
    type: isHold ? "Hold" : "Circle",
    endTime,
  };
}

/**
 * Parses the raw text contents of a .osu file (mania mode) into hit objects,
 * sorted by time, matching PatternFinder.ParseHitObjects.
 */
export function parseOsuFile(fileContents: string): ParsedOsuFile {
  const lines = fileContents.split(/\r?\n/);

  let circleSize = 4;
  let section: string | null = null;
  const hitObjectLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    if (section === "Difficulty" && line.startsWith("CircleSize:")) {
      const value = Number(line.split(":")[1]);
      if (!Number.isNaN(value)) circleSize = value;
      continue;
    }

    if (section === "HitObjects") {
      if (line.startsWith("//")) continue;
      hitObjectLines.push(line);
    }
  }

  const keyCount = Math.round(circleSize) || 4;
  const hitObjects = hitObjectLines
    .map((line) => parseHitObjectLine(line, keyCount))
    .filter((h): h is HitObject => h !== null)
    .sort((a, b) => a.time - b.time);

  return { circleSize: keyCount, hitObjects };
}
