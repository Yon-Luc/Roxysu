import { OsuFileParser } from "../parser/osuFileParser.js";
import type {
  ChartNote,
  PatternAnalysisResult,
  PatternLabel,
  PatternMetrics,
} from "./types";

const HOLD_EPS_MS = 20;
const JACK_IOI_MS = 140;
const CHORD_EPS_MS = 8;
const STREAM_WINDOW_MS = 200;
const STREAM_MIN_NOTES = 4;
const BRACKET_WINDOW_MS = 60;
const OUTER_LEFT = 0;
const OUTER_RIGHT = 6;
const MIN_DOMINANCE_GAP = 0.04;

function isHold(note: ChartNote): boolean {
  return note.endMs > note.startMs + HOLD_EPS_MS;
}

function sortedNoteOrder(notes: ChartNote[]): number[] {
  return notes
    .map((_, i) => i)
    .sort((a, b) => {
      const dt = notes[a]!.startMs - notes[b]!.startMs;
      return dt !== 0 ? dt : a - b;
    });
}

function notesFromParser(parser: OsuFileParser): ChartNote[] {
  const notes: ChartNote[] = [];
  for (let i = 0; i < parser.noteStarts.length; i += 1) {
    notes.push({
      column: parser.columns[i]!,
      startMs: parser.noteStarts[i]!,
      endMs: parser.noteEnds[i]!,
    });
  }
  notes.sort((a, b) => a.startMs - b.startMs || a.column - b.column);
  return notes;
}

/** Per-note local tags used to derive chart-wide densities. */
function tagNotes(notes: ChartNote[]): {
  isJack: boolean[];
  isChord: boolean[];
  isStream: boolean[];
  isBracket: boolean[];
  chordSize: number[];
  prevColGap: (number | null)[];
} {
  const n = notes.length;
  const isJack = new Array<boolean>(n).fill(false);
  const isChord = new Array<boolean>(n).fill(false);
  const isStream = new Array<boolean>(n).fill(false);
  const isBracket = new Array<boolean>(n).fill(false);
  const chordSize = new Array<number>(n).fill(1);
  const prevColGap = new Array<number | null>(n).fill(null);

  const order = sortedNoteOrder(notes);
  const lastStartByCol = new Map<number, number>();
  const lastIdxByCol = new Map<number, number>();

  for (const i of order) {
    const note = notes[i]!;
    const prevStart = lastStartByCol.get(note.column);
    if (prevStart != null) {
      const gap = note.startMs - prevStart;
      if (gap > 0 && gap <= JACK_IOI_MS) {
        isJack[i] = true;
        const prevIdx = lastIdxByCol.get(note.column);
        if (prevIdx != null) isJack[prevIdx] = true;
      }
    }
    lastStartByCol.set(note.column, note.startMs);
    lastIdxByCol.set(note.column, i);
  }

  let lo = 0;
  for (let hi = 0; hi < order.length; hi += 1) {
    const hiIdx = order[hi]!;
    const tHi = notes[hiIdx]!.startMs;

    while (lo < hi && notes[order[lo]!]!.startMs < tHi - STREAM_WINDOW_MS) {
      lo += 1;
    }

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
    const cs = chordHi - chordLo + 1;
    for (let k = chordLo; k <= chordHi; k += 1) {
      const idx = order[k]!;
      chordSize[idx] = Math.max(chordSize[idx]!, cs);
      if (cs >= 2) isChord[idx] = true;
    }

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
    if (count >= STREAM_MIN_NOTES && cols.size >= 2 && cs < 3) {
      for (let k = lo; k <= streamEnd; k += 1) {
        isStream[order[k]!] = true;
      }
    }

    if (hi > 0) {
      const prevIdx = order[hi - 1]!;
      prevColGap[hiIdx] = Math.abs(
        notes[hiIdx]!.column - notes[prevIdx]!.column,
      );
    }
  }

  // Bracket: outer columns 0+6 in same chord or rapid alternation.
  for (let hi = 0; hi < order.length; hi += 1) {
    const hiIdx = order[hi]!;
    const note = notes[hiIdx]!;
    if (note.column !== OUTER_LEFT && note.column !== OUTER_RIGHT) continue;

    const partner = note.column === OUTER_LEFT ? OUTER_RIGHT : OUTER_LEFT;
    const tHi = note.startMs;

    for (let lo = hi; lo >= 0; lo -= 1) {
      const loIdx = order[lo]!;
      const other = notes[loIdx]!;
      if (tHi - other.startMs > BRACKET_WINDOW_MS) break;
      if (other.column === partner) {
        isBracket[hiIdx] = true;
        isBracket[loIdx] = true;
      }
    }
  }

  return { isJack, isChord, isStream, isBracket, chordSize, prevColGap };
}

function density(flags: boolean[]): number {
  if (flags.length === 0) return 0;
  let n = 0;
  for (const f of flags) if (f) n += 1;
  return n / flags.length;
}

function computeMetrics(notes: ChartNote[]): PatternMetrics {
  const tagged = tagNotes(notes);
  const n = notes.length;

  let chordjackHits = 0;
  let jumpstreamHits = 0;
  let chordstreamHits = 0;
  let streamHits = 0;

  for (let i = 0; i < n; i += 1) {
    if (tagged.isJack[i] && tagged.isChord[i]) chordjackHits += 1;
    if (tagged.isStream[i]) {
      streamHits += 1;
      const gap = tagged.prevColGap[i];
      if (gap != null && gap >= 2) jumpstreamHits += 1;
      if (tagged.chordSize[i]! >= 2) chordstreamHits += 1;
    }
  }

  const streamDensity = density(tagged.isStream);
  const chordDensity = density(tagged.isChord);

  return {
    columnCount: 7,
    jackDensity: density(tagged.isJack),
    chordDensity,
    streamDensity,
    bracketDensity: density(tagged.isBracket),
    chordjackScore: n > 0 ? chordjackHits / n : 0,
    jumpstreamScore: streamHits > 0 ? jumpstreamHits / streamHits : 0,
    chordstreamScore: streamHits > 0 ? chordstreamHits / streamHits : 0,
  };
}

type ScoredPattern = { label: PatternLabel; score: number };

function scorePatterns(metrics: PatternMetrics): ScoredPattern[] {
  const jackScore =
    metrics.jackDensity * (1 - Math.min(1, metrics.chordDensity * 2));
  const chordjackScore =
    metrics.chordjackScore *
    (1 + metrics.jackDensity) *
    (1 - Math.min(1, metrics.bracketDensity * 1.5));
  const jumpstreamScore =
    metrics.streamDensity * metrics.jumpstreamScore * (1 - chordjackScore * 0.5);
  const chordstreamScore =
    metrics.streamDensity * metrics.chordstreamScore * metrics.chordDensity;
  const bracketScore =
    metrics.bracketDensity * (1 + metrics.bracketDensity + metrics.chordDensity * 0.5);
  const streamScore =
    metrics.streamDensity *
    (1 - metrics.jumpstreamScore) *
    (1 - metrics.chordstreamScore * 0.5);

  return [
    { label: "jack" as const, score: jackScore },
    { label: "chordjack" as const, score: chordjackScore },
    { label: "jumpstream" as const, score: jumpstreamScore },
    { label: "chordstream" as const, score: chordstreamScore },
    { label: "bracket" as const, score: bracketScore },
    { label: "stream" as const, score: streamScore },
  ].sort((a, b) => b.score - a.score);
}

function pickDominant(scored: ScoredPattern[]): {
  dominant: PatternLabel;
  secondary: PatternLabel | null;
  confidence: number;
} {
  if (scored.length === 0 || scored[0]!.score <= 0) {
    return { dominant: "mixed", secondary: null, confidence: 0 };
  }

  const top = scored[0]!;
  const second = scored[1] ?? { label: "mixed" as PatternLabel, score: 0 };
  const gap = top.score - second.score;

  if (top.score < 0.08) {
    return { dominant: "mixed", secondary: null, confidence: top.score };
  }

  const confidence = Math.min(1, top.score + gap);
  const secondary =
    gap >= MIN_DOMINANCE_GAP && second.score >= 0.08 ? second.label : null;

  return { dominant: top.label, secondary, confidence };
}

/** Analyze parsed 7k chart notes and return dominant pattern + metrics. */
export function analyze7kNotes(notes: ChartNote[]): PatternAnalysisResult {
  const rcNotes = notes.filter((n) => !isHold(n));
  if (rcNotes.length === 0) {
    return {
      columnCount: 7,
      jackDensity: 0,
      chordDensity: 0,
      streamDensity: 0,
      bracketDensity: 0,
      chordjackScore: 0,
      jumpstreamScore: 0,
      chordstreamScore: 0,
      dominantPattern: "mixed",
      secondaryPattern: null,
      confidence: 0,
    };
  }

  const metrics = computeMetrics(rcNotes);
  const scored = scorePatterns(metrics);
  const { dominant, secondary, confidence } = pickDominant(scored);

  return {
    ...metrics,
    dominantPattern: dominant,
    secondaryPattern: secondary,
    confidence,
  };
}

/** Parse `.osu` text and analyze when the chart is 7k mania. */
export function analyze7kFromOsuText(osuText: string): PatternAnalysisResult {
  const parser = new OsuFileParser(osuText);
  parser.process();

  if (parser.status === "NotMania" || parser.gameMode !== "3") {
    throw new Error("Beatmap mode is not mania");
  }
  if (parser.status === "Fail" || parser.columnCount <= 0) {
    throw new Error("Beatmap parse failed");
  }
  if (parser.columnCount !== 7) {
    throw new Error(`Expected 7k chart, got ${parser.columnCount} keys`);
  }

  return analyze7kNotes(notesFromParser(parser));
}
