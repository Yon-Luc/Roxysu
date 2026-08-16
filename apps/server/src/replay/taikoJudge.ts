import type { TaikoHitObject } from "@roxysu/osu-chart";
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
import {
  TAIKO_LEFT_DON,
  TAIKO_LEFT_KAT,
  TAIKO_RIGHT_DON,
  TAIKO_RIGHT_KAT,
  type TaikoReplayFrame,
} from "./decode";

export type TaikoReplayJudgment = {
  noteIndex: number;
  tMs: number;
  result: JudgmentResult;
  errorMs: number | null;
  isTail: boolean;
  kind: "hit" | "roll" | "swell";
};

const TAIKO_RESULT_WEIGHT: Record<JudgmentResult, number> = {
  perfect: 300,
  great: 300,
  good: 150,
  ok: 150,
  meh: 0,
  miss: 0,
};
const TAIKO_ACC_SCALE = 300;

const DON_MASK = TAIKO_LEFT_DON | TAIKO_RIGHT_DON;
const KAT_MASK = TAIKO_LEFT_KAT | TAIKO_RIGHT_KAT;

function difficultyRange(
  od: number,
  min: number,
  mid: number,
  max: number,
): number {
  if (od > 5) return mid + ((max - mid) * (od - 5)) / 5;
  if (od < 5) return mid + ((min - mid) * (5 - od)) / 5;
  return mid;
}

export function taikoHitWindows(od: number): {
  great: number;
  ok: number;
  miss: number;
} {
  return {
    great: difficultyRange(od, 50, 35, 20),
    ok: difficultyRange(od, 120, 80, 50),
    miss: difficultyRange(od, 135, 95, 70),
  };
}

function judgementResult(
  absError: number,
  windows: ReturnType<typeof taikoHitWindows>,
): JudgmentResult {
  const err = Math.abs(absError);
  if (err <= windows.great) return "great";
  if (err <= windows.ok) return "ok";
  return "miss";
}

function taikoAccuracyFromCounts(counts: JudgmentCounts): number {
  const totalWeight =
    counts.perfect * TAIKO_RESULT_WEIGHT.perfect +
    counts.great * TAIKO_RESULT_WEIGHT.great +
    counts.good * TAIKO_RESULT_WEIGHT.good +
    counts.ok * TAIKO_RESULT_WEIGHT.ok +
    counts.meh * TAIKO_RESULT_WEIGHT.meh;
  const judged =
    counts.perfect +
    counts.great +
    counts.good +
    counts.ok +
    counts.meh +
    counts.miss;
  return judged > 0 ? totalWeight / (judged * TAIKO_ACC_SCALE) : 1;
}

function pressEdges(
  frames: TaikoReplayFrame[],
): Array<{ tMs: number; keys: number; rising: number }> {
  const edges: Array<{ tMs: number; keys: number; rising: number }> = [];
  let prev = 0;
  for (const f of frames) {
    const rising = f.keys & ~prev;
    if (rising !== 0) {
      edges.push({ tMs: f.tMs, keys: f.keys, rising });
    }
    prev = f.keys;
  }
  return edges;
}

function colorMask(color: "don" | "kat"): number {
  return color === "don" ? DON_MASK : KAT_MASK;
}

function requiredHitsForSwell(durationMs: number): number {
  return Math.max(1, Math.floor(durationMs / 250));
}

export function simulateTaikoJudgments(args: {
  hitObjects: TaikoHitObject[];
  frames: TaikoReplayFrame[];
  overallDifficulty: number;
  mods: ModAcronyms;
}): { judgments: TaikoReplayJudgment[]; summary: JudgmentSummary } {
  const od = adjustOverallDifficulty(args.overallDifficulty, args.mods);
  const windows = taikoHitWindows(od);
  const rate = args.mods.rate || 1;
  const scale = (n: number) => (rate === 1 ? n : Math.floor(n * rate) + 0.5);
  const w = {
    great: scale(windows.great),
    ok: scale(windows.ok),
    miss: scale(windows.miss),
  };
  const edges = pressEdges(args.frames);
  const used = new Array<boolean>(edges.length).fill(false);
  const judgments: TaikoReplayJudgment[] = [];
  const counts = emptyJudgmentCounts();
  let combo = 0;
  let maxCombo = 0;

  function push(j: TaikoReplayJudgment) {
    judgments.push(j);
    if (j.kind === "hit") {
      counts[j.result] += 1;
      if (j.result === "miss") combo = 0;
      else {
        combo += 1;
        if (combo > maxCombo) maxCombo = combo;
      }
    } else if (j.result !== "miss") {
      combo += 1;
      if (combo > maxCombo) maxCombo = combo;
    }
  }

  let edgeIdx = 0;

  for (let i = 0; i < args.hitObjects.length; i += 1) {
    const obj = args.hitObjects[i]!;

    if (obj.type === "swell") {
      const needed = requiredHitsForSwell(obj.endMs - obj.timeMs);
      let hits = 0;
      for (let e = 0; e < edges.length; e += 1) {
        const edge = edges[e]!;
        if (edge.tMs < obj.timeMs) continue;
        if (edge.tMs > obj.endMs) break;
        if (used[e]) continue;
        used[e] = true;
        hits += 1;
      }
      push({
        noteIndex: i,
        tMs: obj.endMs,
        result: hits >= needed ? "great" : hits > 0 ? "ok" : "miss",
        errorMs: null,
        isTail: false,
        kind: "swell",
      });
      continue;
    }

    if (obj.type === "drumroll") {
      for (const tick of obj.ticks) {
        let hit = false;
        for (let e = 0; e < edges.length; e += 1) {
          const edge = edges[e]!;
          if (used[e]) continue;
          if (Math.abs(edge.tMs - tick.tMs) <= w.ok) {
            used[e] = true;
            hit = true;
            break;
          }
        }
        push({
          noteIndex: i,
          tMs: tick.tMs,
          result: hit ? "great" : "miss",
          errorMs: null,
          isTail: false,
          kind: "roll",
        });
      }
      continue;
    }

    const hitTime = obj.timeMs;
    const want = colorMask(obj.color);
    while (edgeIdx < edges.length && edges[edgeIdx]!.tMs < hitTime - w.miss) {
      edgeIdx += 1;
    }

    let best: { e: number; err: number; rising: number } | null = null;
    for (let e = edgeIdx; e < edges.length; e += 1) {
      if (used[e]) continue;
      const edge = edges[e]!;
      if (edge.tMs > hitTime + w.miss) break;
      const rising = edge.rising & want;
      if (rising === 0) continue;
      const err = edge.tMs - hitTime;
      if (best == null || Math.abs(err) < Math.abs(best.err)) {
        best = { e, err, rising };
      }
    }

    if (best == null) {
      push({
        noteIndex: i,
        tMs: hitTime + w.miss,
        result: "miss",
        errorMs: null,
        isTail: false,
        kind: "hit",
      });
      continue;
    }

    used[best.e] = true;
    let extra = 0;
    if (obj.large) {
      for (let e = 0; e < edges.length; e += 1) {
        if (used[e] || e === best.e) continue;
        const edge = edges[e]!;
        if (Math.abs(edge.tMs - edges[best.e]!.tMs) > 30) continue;
        if ((edge.rising & want) !== 0) {
          used[e] = true;
          extra += 1;
          break;
        }
      }
    }
    const result = judgementResult(best.err, w);
    push({
      noteIndex: i,
      tMs: edges[best.e]!.tMs,
      result: obj.large && extra === 0 && result === "great" ? "ok" : result,
      errorMs: best.err,
      isTail: false,
      kind: "hit",
    });
  }

  judgments.sort((a, b) => a.tMs - b.tMs || a.noteIndex - b.noteIndex);

  return {
    judgments,
    summary: {
      accuracy: taikoAccuracyFromCounts(counts),
      combo,
      maxCombo,
      counts,
    },
  };
}
