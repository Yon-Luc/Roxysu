import { circleRadius, type StdHitObject } from "@roxysu/osu-chart";
import {
  accuracyFromCounts,
  emptyJudgmentCounts,
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

function judgeAbsError(
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

function adjustCs(cs: number, mods: ModAcronyms): number {
  let next = cs;
  if (mods.hardRock) next = Math.min(10, next * 1.3);
  if (mods.easy) next = next * 0.5;
  return next;
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
    cs: adjustCs(args.cs, mods),
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

/**
 * Lightweight Standard judgment sim for rewatch visuals.
 * Circles: OD window + CS radius on click edge.
 * Sliders: head like circle; body/tail pass if cursor near path.
 * Spinners: complete if any click held for most of the duration.
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
      const mid = (obj.timeMs + obj.endMs) / 2;
      const cur = cursorAt(frames, mid);
      const held =
        cur != null &&
        (cur.buttons & 3) !== 0 &&
        obj.endMs - obj.timeMs > 100;
      // Coarse: any held click during spinner → ok, else miss.
      let anyHold = held;
      if (!anyHold) {
        for (const f of frames) {
          if (f.tMs < obj.timeMs) continue;
          if (f.tMs > obj.endMs) break;
          if ((f.buttons & 3) !== 0) {
            anyHold = true;
            break;
          }
        }
      }
      push({
        noteIndex: i,
        tMs: obj.endMs,
        result: anyHold ? "great" : "miss",
        errorMs: null,
        isTail: false,
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
        });
      } else {
        const result = judgeAbsError(best.err, w);
        push({
          noteIndex: i,
          tMs: best.tMs,
          result,
          errorMs: best.err,
          isTail: false,
        });
      }
      continue;
    }

    // Slider: head judgment + simplified body pass.
    if (best == null) {
      push({
        noteIndex: i,
        tMs: hitTime + w.miss,
        result: "miss",
        errorMs: null,
        isTail: false,
      });
      continue;
    }

    const headResult = judgeAbsError(best.err, w);
    if (headResult === "miss") {
      push({
        noteIndex: i,
        tMs: best.tMs,
        result: "miss",
        errorMs: best.err,
        isTail: false,
      });
      continue;
    }

    // Sample a few points along the slider lifetime for cursor proximity.
    let near = 0;
    let samples = 0;
    const path = obj.path;
    for (let s = 0; s <= 8; s += 1) {
      const u = s / 8;
      const tMs = obj.timeMs + (obj.endMs - obj.timeMs) * u;
      const cur = cursorAt(frames, tMs);
      samples += 1;
      if (!cur || path.length === 0) continue;
      // Distance to nearest path point (coarse).
      let minD = Infinity;
      const step = Math.max(1, Math.floor(path.length / 16));
      for (let p = 0; p < path.length; p += step) {
        const pt = path[p]!;
        minD = Math.min(minD, dist(cur.x, cur.y, pt.x, pt.y));
      }
      if (minD <= radius * 2.5) near += 1;
    }
    const bodyOk = samples === 0 || near / samples >= 0.4;
    push({
      noteIndex: i,
      tMs: best.tMs,
      result: bodyOk ? headResult : "ok",
      errorMs: best.err,
      isTail: false,
    });
  }

  return {
    judgments,
    summary: {
      accuracy: accuracyFromCounts(counts),
      combo,
      maxCombo,
      counts,
    },
  };
}
