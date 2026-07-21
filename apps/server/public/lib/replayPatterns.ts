/** Local pattern context + timing stats from chart notes + judgments. */

import type { ChartNote } from "@roxysu/osu-chart";

export type { ChartNote };

export type JudgmentLike = {
  noteIndex: number;
  tMs: number;
  result: string;
  errorMs: number | null;
  isTail?: boolean;
};

export type PatternTag =
  | "jack"
  | "chord"
  | "stream"
  | "ln-head"
  | "ln-drop";

export type MissPatternInfo = {
  noteIndex: number;
  tMs: number;
  column: number;
  isTail: boolean;
  result: string;
  tags: PatternTag[];
  /** Gap to previous same-column note, if any. */
  jackGapMs: number | null;
  /** Notes within chord window including this one. */
  chordSize: number;
};

export type TimingStats = {
  count: number;
  mean: number;
  stddev: number;
  earlyPct: number;
  latePct: number;
  /** Histogram bins of errorMs (negative = early). */
  bins: { center: number; count: number }[];
  binWidth: number;
};

export type ColumnHeat = {
  column: number;
  noteCount: number;
  missCount: number;
  meanAbsError: number | null;
  /** 0–1 intensity for heatmap tint. */
  intensity: number;
};

const HOLD_EPS_MS = 20;
const JACK_IOI_MS = 140;
const CHORD_EPS_MS = 8;
const STREAM_WINDOW_MS = 200;
const STREAM_MIN_NOTES = 4;
const HIST_BIN_MS = 5;
const HIST_HALF_RANGE = 100;

function isHold(note: ChartNote): boolean {
  return note.endMs > note.startMs + HOLD_EPS_MS;
}

/** Indices sorted by startMs (stable for ties). */
function sortedNoteOrder(notes: ChartNote[]): number[] {
  return notes
    .map((_, i) => i)
    .sort((a, b) => {
      const dt = notes[a]!.startMs - notes[b]!.startMs;
      return dt !== 0 ? dt : a - b;
    });
}

/** Tag each miss with local pattern context. */
export function analyzeMissPatterns(
  notes: ChartNote[],
  judgments: JudgmentLike[],
): MissPatternInfo[] {
  const order = sortedNoteOrder(notes);
  const jackGap = new Array<number | null>(notes.length).fill(null);
  const chordSize = new Array<number>(notes.length).fill(1);
  const streamish = new Array<boolean>(notes.length).fill(false);

  const lastStartByCol = new Map<number, number>();
  for (const i of order) {
    const n = notes[i]!;
    const prev = lastStartByCol.get(n.column);
    if (prev != null) jackGap[i] = n.startMs - prev;
    lastStartByCol.set(n.column, n.startMs);
  }

  // Sliding window for chords and stream density.
  let lo = 0;
  for (let hi = 0; hi < order.length; hi += 1) {
    const hiIdx = order[hi]!;
    const tHi = notes[hiIdx]!.startMs;
    while (lo < hi && notes[order[lo]!]!.startMs < tHi - STREAM_WINDOW_MS) {
      lo += 1;
    }

    // Chord: expand while within CHORD_EPS of tHi (symmetric via later pass).
    let chordLo = hi;
    while (
      chordLo > 0 &&
      tHi - notes[order[chordLo - 1]!]!.startMs <= CHORD_EPS_MS
    ) {
      chordLo -= 1;
    }
    let chordHi = hi;
    while (
      chordHi + 1 < order.length &&
      notes[order[chordHi + 1]!]!.startMs - tHi <= CHORD_EPS_MS
    ) {
      chordHi += 1;
    }
    chordSize[hiIdx] = chordHi - chordLo + 1;

    // Stream window [lo, end] covering ±STREAM_WINDOW around tHi.
    let streamEnd = hi;
    while (
      streamEnd + 1 < order.length &&
      notes[order[streamEnd + 1]!]!.startMs <= tHi + STREAM_WINDOW_MS
    ) {
      streamEnd += 1;
    }
    const count = streamEnd - lo + 1;
    const cols = new Set<number>();
    for (let k = lo; k <= streamEnd; k += 1) {
      cols.add(notes[order[k]!]!.column);
    }
    streamish[hiIdx] =
      count >= STREAM_MIN_NOTES &&
      cols.size >= 2 &&
      chordSize[hiIdx]! < 3;
  }

  const out: MissPatternInfo[] = [];
  for (const j of judgments) {
    if (j.result !== "miss") continue;
    const note = notes[j.noteIndex];
    if (!note) continue;

    const tags: PatternTag[] = [];
    const gap = jackGap[j.noteIndex] ?? null;
    if (gap != null && gap > 0 && gap <= JACK_IOI_MS) tags.push("jack");
    const cs = chordSize[j.noteIndex] ?? 1;
    if (cs >= 2) tags.push("chord");
    if (streamish[j.noteIndex]) tags.push("stream");
    if (j.isTail) tags.push("ln-drop");
    else if (isHold(note)) tags.push("ln-head");

    out.push({
      noteIndex: j.noteIndex,
      tMs: j.tMs,
      column: note.column,
      isTail: Boolean(j.isTail),
      result: j.result,
      tags,
      jackGapMs: gap,
      chordSize: cs,
    });
  }

  return out;
}

export function summarizePatternTags(
  misses: MissPatternInfo[],
): Record<PatternTag, number> {
  const counts: Record<PatternTag, number> = {
    jack: 0,
    chord: 0,
    stream: 0,
    "ln-head": 0,
    "ln-drop": 0,
  };
  for (const m of misses) {
    for (const t of m.tags) counts[t] += 1;
  }
  return counts;
}

export function computeTimingStats(judgments: JudgmentLike[]): TimingStats {
  const errors: number[] = [];
  for (const j of judgments) {
    if (j.result === "miss" || j.errorMs == null) continue;
    errors.push(j.errorMs);
  }

  const binWidth = HIST_BIN_MS;
  const binCount = Math.floor((HIST_HALF_RANGE * 2) / binWidth);
  const bins = Array.from({ length: binCount }, (_, i) => ({
    center: -HIST_HALF_RANGE + binWidth / 2 + i * binWidth,
    count: 0,
  }));

  if (errors.length === 0) {
    return {
      count: 0,
      mean: 0,
      stddev: 0,
      earlyPct: 0,
      latePct: 0,
      bins,
      binWidth,
    };
  }

  let sum = 0;
  let early = 0;
  let late = 0;
  for (const e of errors) {
    sum += e;
    if (e < 0) early += 1;
    else if (e > 0) late += 1;
    const clamped = Math.min(
      HIST_HALF_RANGE - 0.001,
      Math.max(-HIST_HALF_RANGE, e),
    );
    const idx = Math.floor((clamped + HIST_HALF_RANGE) / binWidth);
    if (idx >= 0 && idx < bins.length) bins[idx]!.count += 1;
  }

  const mean = sum / errors.length;
  let varSum = 0;
  for (const e of errors) varSum += (e - mean) ** 2;
  const stddev = Math.sqrt(varSum / errors.length);

  return {
    count: errors.length,
    mean,
    stddev,
    earlyPct: (early / errors.length) * 100,
    latePct: (late / errors.length) * 100,
    bins,
    binWidth,
  };
}

/**
 * Lane tint intensity from misses only.
 * Clean columns stay clear — timing error is shown in the panel, not as a red wash.
 * Scaled relative to the worst column's miss count so choke lanes stand out.
 */
export function computeColumnHeat(
  notes: ChartNote[],
  judgments: JudgmentLike[],
  columnCount: number,
): ColumnHeat[] {
  const cols = Math.max(1, columnCount);
  const noteCount = new Array(cols).fill(0) as number[];
  const missCount = new Array(cols).fill(0) as number[];
  const absErrSum = new Array(cols).fill(0) as number[];
  const errCount = new Array(cols).fill(0) as number[];

  for (const n of notes) {
    const c = Math.min(cols - 1, Math.max(0, n.column));
    noteCount[c]! += 1;
  }

  for (const j of judgments) {
    const note = notes[j.noteIndex];
    if (!note) continue;
    const c = Math.min(cols - 1, Math.max(0, note.column));
    if (j.result === "miss" && !j.isTail) {
      missCount[c]! += 1;
    }
    if (j.errorMs != null && j.result !== "miss") {
      absErrSum[c]! += Math.abs(j.errorMs);
      errCount[c]! += 1;
    }
  }

  const maxMisses = Math.max(0, ...missCount);

  return Array.from({ length: cols }, (_, column) => {
    const meanAbs =
      errCount[column]! > 0
        ? absErrSum[column]! / errCount[column]!
        : null;
    const misses = missCount[column]!;
    // No misses → no tint. Otherwise scale vs the hottest lane.
    const intensity =
      maxMisses > 0 && misses > 0 ? misses / maxMisses : 0;
    return {
      column,
      noteCount: noteCount[column]!,
      missCount: misses,
      meanAbsError: meanAbs,
      intensity,
    };
  });
}

export const PATTERN_TAG_LABEL: Record<PatternTag, string> = {
  jack: "Jack",
  chord: "Chord",
  stream: "Stream",
  "ln-head": "LN head",
  "ln-drop": "LN drop",
};

/** Fraction accuracy delta above which sim vs stored is flagged. */
export const FIDELITY_ACC_DELTA = 0.02;
