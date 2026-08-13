import { circleRadius, type StdHitObject, type StdPoint } from "@roxysu/osu-chart";
import {
  emptyJudgmentCounts,
  type JudgmentCounts,
  type JudgmentResult,
  type JudgmentSummary,
} from "@roxysu/mania-judge";
import {
  adjustOverallDifficulty,
  type ModAcronyms,
} from "@roxysu/mania-judge/mods";
import type { StdReplayFrame } from "./decode";

export type StdReplayJudgment = {
  noteIndex: number;
  tMs: number;
  result: JudgmentResult;
  errorMs: number | null;
  isTail: boolean;
  /** Slider sub-part this entry describes. */
  kind: "head" | "tick" | "tail";
  /** Path fraction for tick entries (0 = head, 1 = tail). */
  frac?: number;
};

/** Stable-style osu! hit windows (half-widths) from OD. */
export function stdHitWindows(od: number): {
  perfect: number;
  great: number;
  good: number;
  ok: number;
  meh: number;
  miss: number;
} {
  const w300 = Math.max(20, 80 - 6 * od);
  const w100 = Math.max(40, 140 - 8 * od);
  const w50 = Math.max(50, 200 - 10 * od);
  return {
    perfect: w300 * 0.4,
    great: w300,
    good: w100,
    ok: w50,
    meh: w50,
    miss: w50,
  };
}

function judgementResult(
  absError: number,
  windows: ReturnType<typeof stdHitWindows>,
): JudgmentResult {
  const err = Math.abs(absError);
  if (err <= windows.perfect) return "perfect";
  if (err <= windows.great) return "great";
  if (err <= windows.good) return "good";
  if (err <= windows.ok) return "ok";
  return "miss";
}

/** Standard (osu!) accuracy weights — 300/100/50 on a 300 scale. */
const STD_RESULT_WEIGHT: Record<JudgmentResult, number> = {
  perfect: 300,
  great: 300,
  good: 100,
  ok: 50,
  meh: 50,
  miss: 0,
};
const STD_ACC_SCALE = 300;

function stdAccuracyFromCounts(counts: JudgmentCounts): number {
  const totalWeight =
    counts.perfect * STD_RESULT_WEIGHT.perfect +
    counts.great * STD_RESULT_WEIGHT.great +
    counts.good * STD_RESULT_WEIGHT.good +
    counts.ok * STD_RESULT_WEIGHT.ok +
    counts.meh * STD_RESULT_WEIGHT.meh;
  const judged =
    counts.perfect +
    counts.great +
    counts.good +
    counts.ok +
    counts.meh +
    counts.miss;
  return judged > 0 ? totalWeight / (judged * STD_ACC_SCALE) : 1;
}

function adjustAr(ar: number, mods: ModAcronyms): number {
  let next = ar;
  if (mods.hardRock) next = Math.min(10, next * 1.4);
  if (mods.easy) next = next * 0.5;
  return next;
}

export function adjustStdDifficulty(
  args: { cs: number; ar: number; od: number },
  mods: ModAcronyms,
): { cs: number; ar: number; od: number } {
  return {
    // Hard Rock flips the playfield and raises AR/OD but leaves the on-screen
    // circle size (and its hitbox) unchanged — do not scale CS here.
    cs: args.cs,
    ar: adjustAr(args.ar, mods),
    od: adjustOverallDifficulty(args.od, mods),
  };
}

const OSU_HEIGHT = 384;

/** Hard Rock mirrors the playfield vertically. */
export function applyStdHardRockFlip(
  hitObjects: StdHitObject[],
  frames: StdReplayFrame[],
  hardRock: boolean,
): { hitObjects: StdHitObject[]; frames: StdReplayFrame[] } {
  if (!hardRock) return { hitObjects, frames };

  const flipY = (y: number) => OSU_HEIGHT - y;

  const flippedObjects: StdHitObject[] = hitObjects.map((obj) => {
    if (obj.type === "spinner") return obj;
    if (obj.type === "circle") {
      return {
        ...obj,
        y: flipY(obj.y),
        stackY: flipY(obj.stackY),
      };
    }
    return {
      ...obj,
      y: flipY(obj.y),
      stackY: flipY(obj.stackY),
      path: obj.path.map((p) => ({ x: p.x, y: flipY(p.y) })),
    };
  });

  const flippedFrames = frames.map((f) => ({
    ...f,
    y: flipY(f.y),
  }));

  return { hitObjects: flippedObjects, frames: flippedFrames };
}

function cursorAt(
  frames: StdReplayFrame[],
  tMs: number,
): { x: number; y: number; buttons: number } | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.tMs <= tMs) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo - 1;
  if (idx < 0) return frames[0]!;
  const a = frames[idx]!;
  const b = frames[idx + 1];
  if (!b || b.tMs === a.tMs) return a;
  const u = (tMs - a.tMs) / (b.tMs - a.tMs);
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    buttons: a.buttons,
  };
}

function isClickEdge(
  prevButtons: number,
  buttons: number,
): boolean {
  const prev = (prevButtons & 3) !== 0;
  const next = (buttons & 3) !== 0;
  return !prev && next;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function pathPointAt(path: StdPoint[], frac: number): StdPoint {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return path[0]!;
  const f = Math.min(1, Math.max(0, frac)) * (path.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(path.length - 1, i0 + 1);
  const t = f - i0;
  const a = path[i0]!;
  const b = path[i1]!;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Ball path fraction at time fraction `u` of the whole slider (bounces on repeats). */
function bounceFracAt(u: number, repeats: number): number {
  const prog = Math.min(repeats, Math.max(0, u * repeats));
  const seg = Math.floor(prog);
  let local = prog - seg;
  if (seg % 2 === 1) local = 1 - local;
  return Math.min(1, Math.max(0, local));
}

/**
 * Lightweight Standard judgment sim for rewatch visuals.
 * Circles: OD window + CS radius on click edge.
 * Sliders: head like circle; ticks sampled on the path; tail by follow.
 * Spinners: held for most of the duration.
 * Ticks and tails are emitted as separate entries so combo/accuracy match
 * real osu! semantics (approximations, documented in knowledge/).
 */
export function simulateStdJudgments(args: {
  hitObjects: StdHitObject[];
  frames: StdReplayFrame[];
  circleSize: number;
  overallDifficulty: number;
  mods: ModAcronyms;
}): { judgments: StdReplayJudgment[]; summary: JudgmentSummary } {
  const mods = args.mods;
  const diff = adjustStdDifficulty(
    {
      cs: args.circleSize,
      ar: 5,
      od: args.overallDifficulty,
    },
    mods,
  );
  const windows = stdHitWindows(diff.od);
  // Scale windows with rate like mania (map-time expansion).
  const rate = mods.rate || 1;
  const scale = (n: number) => (rate === 1 ? n : Math.floor(n * rate) + 0.5);
  const w = {
    perfect: scale(windows.perfect),
    great: scale(windows.great),
    good: scale(windows.good),
    ok: scale(windows.ok),
    meh: scale(windows.meh),
    miss: scale(windows.miss),
  };
  const radius = circleRadius(diff.cs);
  const frames = args.frames;
  const judgments: StdReplayJudgment[] = [];
  const counts = emptyJudgmentCounts();
  let combo = 0;
  let maxCombo = 0;

  function push(j: StdReplayJudgment) {
    judgments.push(j);
    counts[j.result] += 1;
    if (j.result === "miss") combo = 0;
    else {
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;
    }
  }

  let prevButtons = 0;
  const clickEdges: Array<{ tMs: number; x: number; y: number }> = [];
  for (const f of frames) {
    if (isClickEdge(prevButtons, f.buttons)) {
      clickEdges.push({ tMs: f.tMs, x: f.x, y: f.y });
    }
    prevButtons = f.buttons;
  }

  let clickIdx = 0;

  for (let i = 0; i < args.hitObjects.length; i += 1) {
    const obj = args.hitObjects[i]!;

    if (obj.type === "spinner") {
      const start = obj.timeMs;
      const end = obj.endMs;
      const dur = end - start;
      // Held fraction over the spinner lifetime (rotation itself is not
      // recorded in replays — click-hold coverage is the approximation).
      let heldSamples = 0;
      let samples = 0;
      for (const f of frames) {
        if (f.tMs < start) continue;
        if (f.tMs > end) break;
        samples += 1;
        if ((f.buttons & 3) !== 0) heldSamples += 1;
      }
      const holdRatio = samples > 0 ? heldSamples / samples : 0;
      let result: JudgmentResult = "miss";
      if (samples > 0 && dur > 100 && holdRatio >= 0.5) result = "great";
      else if (samples > 0 && holdRatio > 0) result = "ok";
      push({
        noteIndex: i,
        tMs: end,
        result,
        errorMs: null,
        isTail: false,
        kind: "head",
      });
      continue;
    }

    const hx = obj.stackX;
    const hy = obj.stackY;
    const hitTime = obj.timeMs;

    // Advance click pointer to near this object.
    while (
      clickIdx < clickEdges.length &&
      clickEdges[clickIdx]!.tMs < hitTime - w.miss
    ) {
      clickIdx += 1;
    }

    let best: { tMs: number; x: number; y: number; err: number } | null =
      null;
    for (let c = clickIdx; c < clickEdges.length; c += 1) {
      const click = clickEdges[c]!;
      if (click.tMs > hitTime + w.miss) break;
      const err = click.tMs - hitTime;
      if (
        dist(click.x, click.y, hx, hy) <= radius * 1.05 &&
        (best == null || Math.abs(err) < Math.abs(best.err))
      ) {
        best = { ...click, err };
      }
    }

    if (obj.type === "circle") {
      if (best == null) {
        push({
          noteIndex: i,
          tMs: hitTime + w.miss,
          result: "miss",
          errorMs: null,
          isTail: false,
          kind: "head",
        });
      } else {
        const result = judgementResult(best.err, w);
        push({
          noteIndex: i,
          tMs: best.tMs,
          result,
          errorMs: best.err,
          isTail: false,
          kind: "head",
        });
      }
      continue;
    }

    // Slider: head judgment, then ticks and tail on the hit path.
    if (best == null) {
      push({
        noteIndex: i,
        tMs: hitTime + w.miss,
        result: "miss",
        errorMs: null,
        isTail: false,
        kind: "head",
      });
      continue;
    }
    const headResult = judgementResult(best.err, w);
    push({
      noteIndex: i,
      tMs: best.tMs,
      result: headResult,
      errorMs: best.err,
      isTail: false,
      kind: "head",
    });
    if (headResult === "miss") continue;

    const path = obj.path;
    // Tail rests at the path end for odd repeat counts, the head otherwise.
    const tailPoint = pathPointAt(path, obj.repeats % 2 === 1 ? 1 : 0);

    // Ticks: cursor next to the tick point with a button held.
    for (const tick of obj.ticks ?? []) {
      const cur = cursorAt(frames, tick.tMs);
      const pt = pathPointAt(path, tick.frac);
      const held = cur != null && (cur.buttons & 3) !== 0;
      const near = cur != null && dist(cur.x, cur.y, pt.x, pt.y) <= radius * 2.5;
      push({
        noteIndex: i,
        tMs: tick.tMs,
        result: held && near ? "great" : "miss",
        errorMs: null,
        isTail: false,
        kind: "tick",
        frac: tick.frac,
      });
    }

    // Tail: ball-precise follow sampling, then final position + hold.
    let nearCount = 0;
    let sampleCount = 0;
    for (let s = 0; s <= 8; s += 1) {
      const u = s / 8;
      const tMs = obj.timeMs + (obj.endMs - obj.timeMs) * u;
      const cur = cursorAt(frames, tMs);
      sampleCount += 1;
      if (!cur || path.length === 0) continue;
      const pt = pathPointAt(path, bounceFracAt(u, obj.repeats));
      if (dist(cur.x, cur.y, pt.x, pt.y) <= radius * 2.5) nearCount += 1;
    }
    const bodyOk = sampleCount === 0 || nearCount / sampleCount >= 0.4;
    const curEnd = cursorAt(frames, obj.endMs);
    const heldEnd = curEnd != null && (curEnd.buttons & 3) !== 0;
    const nearEnd =
      curEnd != null &&
      dist(curEnd.x, curEnd.y, tailPoint.x, tailPoint.y) <= radius * 2.5;
    push({
      noteIndex: i,
      tMs: obj.endMs,
      result: nearEnd && heldEnd ? "great" : bodyOk ? "ok" : "miss",
      errorMs: null,
      isTail: true,
      kind: "tail",
    });
  }

  // Time order keeps client combo/accuracy accumulation incremental.
  judgments.sort((a, b) => a.tMs - b.tMs || a.noteIndex - b.noteIndex);

  return {
    judgments,
    summary: {
      accuracy: stdAccuracyFromCounts(counts),
      combo,
      maxCombo,
      counts,
    },
  };
}
