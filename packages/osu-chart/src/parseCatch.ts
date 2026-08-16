import { catcherWidth, type CatchHitObject, type ParsedCatchChart } from "./catchTypes";
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
const ALLOWED_CATCH_RANGE = 0.8;
const TINY_DROPLET_INTERVAL_MS = 32;
const BANANA_INTERVAL_MS = 60;

function clampX(x: number): number {
  return Math.min(OSU_WIDTH, Math.max(0, x));
}

function bananaX(timeMs: number, index: number): number {
  const n = ((timeMs * 1103515245 + index * 12345) >>> 0) % 10000;
  return (n / 10000) * OSU_WIDTH;
}

function applyHyperDash(objects: CatchHitObject[], cs: number): void {
  const halfWidth = (catcherWidth(cs) / 2) * ALLOWED_CATCH_RANGE;
  const fruits = objects.filter((o): o is Extract<CatchHitObject, { type: "fruit" }> => o.type === "fruit");
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
      const endMs = timeMs + span * repeats;
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
      });

      for (const tick of ticks) {
        const pt = pathPointAt(path, bounceFracAt(tick.frac, 1));
        const spanIndex = Math.floor((tick.tMs - timeMs) / span);
        const localFrac =
          spanIndex % 2 === 1 ? 1 - tick.frac : tick.frac;
        const p = pathPointAt(path, localFrac);
        objects.push({
          type: "droplet",
          x: clampX(p.x ?? pt.x),
          timeMs: tick.tMs,
          kind: "large",
        });
      }

      for (let s = 1; s <= repeats; s += 1) {
        const t = timeMs + s * span;
        const frac = bounceFracAt(s / repeats, repeats);
        const pt = pathPointAt(path, frac);
        objects.push({
          type: "fruit",
          x: clampX(pt.x),
          timeMs: t,
          hyperDash: false,
        });
      }

      const duration = endMs - timeMs;
      if (duration > TINY_DROPLET_INTERVAL_MS) {
        for (
          let t = timeMs + TINY_DROPLET_INTERVAL_MS;
          t < endMs - 1;
          t += TINY_DROPLET_INTERVAL_MS
        ) {
          const u = (t - timeMs) / duration;
          const pt = pathPointAt(path, bounceFracAt(u, repeats));
          const nearTick = ticks.some((tk) => Math.abs(tk.tMs - t) < 8);
          const nearFruit =
            Math.abs(t - timeMs) < 8 || Math.abs(t - endMs) < 8;
          if (nearTick || nearFruit) continue;
          objects.push({
            type: "droplet",
            x: clampX(pt.x),
            timeMs: t,
            kind: "tiny",
          });
        }
      }
      continue;
    }

    if (type & HIT_CIRCLE) {
      objects.push({
        type: "fruit",
        x: clampX(x),
        timeMs,
        hyperDash: false,
      });
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
    timingPoints: uninherited.length ? uninherited : [[0, 500]],
    breaks: parseBreaks(lines),
    metaData: parseMeta(lines),
  };
}

export type { ParsedCatchChart, CatchHitObject };
export { catcherWidth };
