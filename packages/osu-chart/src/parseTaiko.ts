import type { ParsedTaikoChart, TaikoColor, TaikoHitObject } from "./taikoTypes";
import {
  HIT_CIRCLE,
  HIT_SLIDER,
  HIT_SPINNER,
  HITSOUND_CLAP,
  HITSOUND_FINISH,
  HITSOUND_WHISTLE,
  computeSliderTicks,
  parseBreaks,
  parseDifficulty,
  parseMeta,
  parseMode,
  parseTimingPoints,
  spanDurationMs,
  timingAt,
} from "./osuFileCommon";

function taikoColor(hitsound: number): TaikoColor {
  return (hitsound & HITSOUND_WHISTLE) !== 0 || (hitsound & HITSOUND_CLAP) !== 0
    ? "kat"
    : "don";
}

function isLarge(hitsound: number): boolean {
  return (hitsound & HITSOUND_FINISH) !== 0;
}

function parseHitObjects(
  lines: string[],
  timing: ReturnType<typeof parseTimingPoints>,
  sliderMultiplier: number,
  sliderTickRate: number,
): TaikoHitObject[] {
  const objects: TaikoHitObject[] = [];
  let inHit = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("[")) {
      inHit = line === "[HitObjects]";
      continue;
    }
    if (!inHit) continue;

    const parts = line.split(",");
    if (parts.length < 5) continue;
    const timeMs = Number.parseFloat(parts[2]!);
    const type = Number.parseInt(parts[3]!, 10);
    const hitsound = Number.parseInt(parts[4]!, 10) || 0;
    if (!Number.isFinite(timeMs) || !Number.isFinite(type)) continue;

    if (type & HIT_SPINNER) {
      const endMs = Number.parseFloat(parts[5] ?? "");
      if (!Number.isFinite(endMs) || endMs <= timeMs) continue;
      objects.push({ type: "swell", timeMs, endMs });
      continue;
    }

    if (type & HIT_SLIDER) {
      if (parts.length < 8) continue;
      const repeats = Math.max(1, Number.parseInt(parts[6]!, 10) || 1);
      const pixelLength = Number.parseFloat(parts[7]!);
      if (!Number.isFinite(pixelLength) || pixelLength <= 0) continue;
      const { beatLength, sliderVelocity } = timingAt(timing, timeMs);
      const span = spanDurationMs(
        pixelLength,
        sliderMultiplier,
        sliderVelocity,
        beatLength,
      );
      const endMs = timeMs + span * repeats;
      objects.push({
        type: "drumroll",
        timeMs,
        endMs,
        large: isLarge(hitsound),
        ticks: computeSliderTicks(
          timeMs,
          span,
          beatLength,
          sliderTickRate,
          repeats,
        ).map((t) => ({ tMs: t.tMs })),
      });
      continue;
    }

    if (type & HIT_CIRCLE) {
      objects.push({
        type: "hit",
        timeMs,
        color: taikoColor(hitsound),
        large: isLarge(hitsound),
      });
    }
  }

  objects.sort((a, b) => a.timeMs - b.timeMs);
  return objects;
}

export function parseTaikoChart(osuText: string): ParsedTaikoChart {
  const lines = osuText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const mode = parseMode(lines);
  const empty = (): ParsedTaikoChart => ({
    gameMode: "1",
    status: "Fail",
    circleSize: 5,
    approachRate: 5,
    overallDifficulty: 5,
    sliderMultiplier: 1.4,
    sliderTickRate: 1,
    hitObjects: [],
    timingPoints: [],
    breaks: [],
    metaData: {},
  });

  if (mode != null && mode !== "1") {
    return { ...empty(), status: "NotTaiko" };
  }

  const diff = parseDifficulty(lines);
  const timing = parseTimingPoints(lines);
  const hitObjects = parseHitObjects(
    lines,
    timing,
    diff.sliderMultiplier,
    diff.sliderTickRate,
  );
  const uninherited: Array<[number, number]> = timing
    .filter((t) => t.uninherited)
    .map((t) => [t.timeMs, t.beatLength]);

  return {
    gameMode: "1",
    status: hitObjects.length > 0 ? "OK" : "Fail",
    circleSize: diff.circleSize,
    approachRate: diff.approachRate,
    overallDifficulty: diff.overallDifficulty,
    sliderMultiplier: diff.sliderMultiplier,
    sliderTickRate: diff.sliderTickRate,
    hitObjects,
    timingPoints: uninherited.length ? uninherited : [[0, 500]],
    breaks: parseBreaks(lines),
    metaData: parseMeta(lines),
  };
}

export type { ParsedTaikoChart, TaikoHitObject, TaikoColor };
