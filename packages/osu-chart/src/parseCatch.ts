import {
  catcherWidth,
  type CatchHitObject,
  type ParsedCatchChart,
} from "./catchTypes";
import { parseBeatmapComboColors } from "./parseStd";
import {
  HIT_CIRCLE,
  HIT_SLIDER,
  HIT_SPINNER,
  bounceFracAt,
  computeSliderTicks,
  parseBreaks,
  parseDifficulty,
  parseMeta,
  parseMode,
  parseSliderPath,
  parseTimingPoints,
  pathPointAt,
  sampleCurve,
  spanDurationMs,
  timingAt,
} from "./osuFileCommon";

const OSU_WIDTH = 512;
const CATCHER_BASE_SPEED = 1;
/** Match judge plate tolerance (`halfWidth * 1.02`) for hyperdash distance. */
const ALLOWED_CATCH_RANGE = 1.02;
/** Lazer inserts tiny droplets only when the gap between slider events exceeds this. */
const TINY_DROPLET_MIN_GAP_MS = 80;
/** Subdivide that gap until the step is at most this long. */
const TINY_DROPLET_MAX_STEP_MS = 100;
const BANANA_INTERVAL_MS = 60;
const HIT_NEW_COMBO = 4;

function clampX(x: number): number {
  return Math.min(OSU_WIDTH, Math.max(0, x));
}

function comboFlags(type: number): { newCombo: boolean; comboOffset: number } {
  return {
    newCombo: (type & HIT_NEW_COMBO) !== 0,
    comboOffset: (type >> 4) & 0b111,
  };
}

function bananaX(timeMs: number, index: number): number {
  const n = ((timeMs * 1103515245 + index * 12345) >>> 0) % 10000;
  return (n / 10000) * OSU_WIDTH;
}

/** Deterministic ±20px nudge, matching lazer's tiny-droplet X offset range. */
function tinyDropletOffset(timeMs: number, index: number): number {
  const n =
    ((Math.floor(timeMs) * 1103515245 + index * 12345) >>> 0) % 10000;
  return (n / 10000) * 40 - 20;
}

function applyHyperDash(objects: CatchHitObject[], cs: number): void {
  const halfWidth = (catcherWidth(cs) / 2) * ALLOWED_CATCH_RANGE;
  const fruits = objects.filter(
    (o): o is Extract<CatchHitObject, { type: "fruit" }> => o.type === "fruit",
  );
  for (let i = 0; i < fruits.length - 1; i += 1) {
    const cur = fruits[i]!;
    const next = fruits[i + 1]!;
    const dt = next.timeMs - cur.timeMs;
    if (dt <= 0) continue;
    const dist = Math.abs(next.x - cur.x);
    if (dist - halfWidth > dt * CATCHER_BASE_SPEED) {
      cur.hyperDash = true;
    }
  }
}

function parseHitObjects(
  lines: string[],
  timing: ReturnType<typeof parseTimingPoints>,
  sliderMultiplier: number,
  sliderTickRate: number,
): CatchHitObject[] {
  const objects: CatchHitObject[] = [];
  let fruitIndex = 0;
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
    const x = Number.parseFloat(parts[0]!);
    const y = Number.parseFloat(parts[1]!);
    const timeMs = Number.parseFloat(parts[2]!);
    const type = Number.parseInt(parts[3]!, 10);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(timeMs) ||
      !Number.isFinite(type)
    ) {
      continue;
    }

    if (type & HIT_SPINNER) {
      const endMs = Number.parseFloat(parts[5] ?? "");
      if (!Number.isFinite(endMs) || endMs <= timeMs) continue;
      let i = 0;
      for (let t = timeMs; t < endMs; t += BANANA_INTERVAL_MS) {
        objects.push({ type: "banana", x: bananaX(t, i), timeMs: t });
        i += 1;
      }
      continue;
    }

    if (type & HIT_SLIDER) {
      if (parts.length < 8) continue;
      const { newCombo, comboOffset } = comboFlags(type);
      const { curveType, controls } = parseSliderPath(parts[5]!, { x, y });
      const repeats = Math.max(1, Number.parseInt(parts[6]!, 10) || 1);
      const pixelLength = Number.parseFloat(parts[7]!);
      if (!Number.isFinite(pixelLength) || pixelLength <= 0) continue;
      const path = sampleCurve(curveType, controls, pixelLength);
      const { beatLength, sliderVelocity } = timingAt(timing, timeMs);
      const span = spanDurationMs(
        pixelLength,
        sliderMultiplier,
        sliderVelocity,
        beatLength,
      );
      const ticks = computeSliderTicks(
        timeMs,
        span,
        beatLength,
        sliderTickRate,
        repeats,
      );

      objects.push({
        type: "fruit",
        x: clampX(x),
        timeMs,
        hyperDash: false,
        newCombo,
        comboOffset,
        indexInBeatmap: fruitIndex,
      });
      fruitIndex += 1;

      const sliderEvents: { tMs: number; pathFrac: number }[] = [
        { tMs: timeMs, pathFrac: 0 },
      ];

      for (const tick of ticks) {
        const spanIndex = Math.floor((tick.tMs - timeMs) / span);
        const localFrac = spanIndex % 2 === 1 ? 1 - tick.frac : tick.frac;
        const p = pathPointAt(path, localFrac);
        objects.push({
          type: "droplet",
          x: clampX(p.x),
          timeMs: tick.tMs,
          kind: "large",
        });
        sliderEvents.push({ tMs: tick.tMs, pathFrac: localFrac });
      }

      for (let s = 1; s <= repeats; s += 1) {
        const t = timeMs + s * span;
        const pathFrac = bounceFracAt(s / repeats, repeats);
        const pt = pathPointAt(path, pathFrac);
        objects.push({
          type: "fruit",
          x: clampX(pt.x),
          timeMs: t,
          hyperDash: false,
          newCombo: false,
          comboOffset: 0,
          indexInBeatmap: fruitIndex,
        });
        fruitIndex += 1;
        sliderEvents.push({ tMs: t, pathFrac });
      }

      sliderEvents.sort((a, b) => a.tMs - b.tMs);
      let tinyIndex = 0;
      for (let e = 1; e < sliderEvents.length; e += 1) {
        const prev = sliderEvents[e - 1]!;
        const next = sliderEvents[e]!;
        const since = next.tMs - prev.tMs;
        if (!(since > TINY_DROPLET_MIN_GAP_MS)) continue;
        let step = since;
        while (step > TINY_DROPLET_MAX_STEP_MS) step /= 2;
        for (let dt = step; dt < since; dt += step) {
          const pathFrac =
            prev.pathFrac + (next.pathFrac - prev.pathFrac) * (dt / since);
          const pt = pathPointAt(path, pathFrac);
          const offset = tinyDropletOffset(prev.tMs + dt, tinyIndex);
          tinyIndex += 1;
          objects.push({
            type: "droplet",
            x: clampX(pt.x + offset),
            timeMs: prev.tMs + dt,
            kind: "tiny",
          });
        }
      }
      continue;
    }

    if (type & HIT_CIRCLE) {
      const { newCombo, comboOffset } = comboFlags(type);
      objects.push({
        type: "fruit",
        x: clampX(x),
        timeMs,
        hyperDash: false,
        newCombo,
        comboOffset,
        indexInBeatmap: fruitIndex,
      });
      fruitIndex += 1;
    }
  }

  objects.sort((a, b) => a.timeMs - b.timeMs || a.x - b.x);
  return objects;
}

export function parseCatchChart(osuText: string): ParsedCatchChart {
  const lines = osuText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const mode = parseMode(lines);
  const empty = (): ParsedCatchChart => ({
    gameMode: "2",
    status: "Fail",
    circleSize: 5,
    approachRate: 5,
    overallDifficulty: 5,
    sliderMultiplier: 1.4,
    sliderTickRate: 1,
    hitObjects: [],
    comboColors: [],
    timingPoints: [],
    breaks: [],
    metaData: {},
  });

  if (mode != null && mode !== "2") {
    return { ...empty(), status: "NotCatch" };
  }

  const diff = parseDifficulty(lines);
  const timing = parseTimingPoints(lines);
  const hitObjects = parseHitObjects(
    lines,
    timing,
    diff.sliderMultiplier,
    diff.sliderTickRate,
  );
  applyHyperDash(hitObjects, diff.circleSize);

  const uninherited: Array<[number, number]> = timing
    .filter((t) => t.uninherited)
    .map((t) => [t.timeMs, t.beatLength]);

  return {
    gameMode: "2",
    status: hitObjects.length > 0 ? "OK" : "Fail",
    circleSize: diff.circleSize,
    approachRate: diff.approachRate,
    overallDifficulty: diff.overallDifficulty,
    sliderMultiplier: diff.sliderMultiplier,
    sliderTickRate: diff.sliderTickRate,
    hitObjects,
    comboColors: parseBeatmapComboColors(lines),
    timingPoints: uninherited.length ? uninherited : [[0, 500]],
    breaks: parseBreaks(lines),
    metaData: parseMeta(lines),
  };
}

export type { ParsedCatchChart, CatchHitObject };
export { catcherWidth };
