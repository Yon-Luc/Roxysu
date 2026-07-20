import type { ChartNote } from "@roxysu/osu-chart";
import type { PatternLabelV2 } from "@roxysu/pattern-7k";

export type PatternContext = {
  columnCount: number;
  snapMs: number;
  rng: () => number;
  /** Emit a note every N snap steps (1 = full density). */
  noteStride: number;
};

/** Emit notes for one pattern over `steps` snap intervals starting at `startMs`. */
export type PatternEmitter = (
  startMs: number,
  steps: number,
  ctx: PatternContext,
) => ChartNote[];

function pushNote(
  out: ChartNote[],
  column: number,
  startMs: number,
  endMs = startMs,
): void {
  out.push({
    column: Math.max(0, Math.min(6, column)),
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
  });
}

function strideOf(ctx: PatternContext): number {
  return Math.max(1, Math.floor(ctx.noteStride));
}

export const PATTERN_EMITTERS: Record<PatternLabelV2, PatternEmitter> = {
  delay: (startMs, steps, ctx) => {
    const notes: ChartNote[] = [];
    const cols = [1, 3, 5, 2, 4, 0, 6, 3];
    const stride = strideOf(ctx);
    for (let i = 0; i < steps; i += stride) {
      pushNote(notes, cols[(i / stride) % cols.length]!, startMs + i * ctx.snapMs);
    }
    return notes;
  },

  jack: (startMs, steps, ctx) => {
    const notes: ChartNote[] = [];
    const col = 2 + Math.floor(ctx.rng() * 3);
    const stride = strideOf(ctx);
    for (let i = 0; i < steps; i += stride) {
      pushNote(notes, col, startMs + i * ctx.snapMs);
    }
    return notes;
  },

  chordjack: (startMs, steps, ctx) => {
    const notes: ChartNote[] = [];
    const jackCol = 3;
    const stride = strideOf(ctx);
    let step = 0;
    for (let i = 0; i < steps; i += stride) {
      const t = startMs + i * ctx.snapMs;
      if (step % 2 === 0) {
        pushNote(notes, 1, t);
        pushNote(notes, 5, t);
      } else {
        pushNote(notes, jackCol, t);
      }
      step += 1;
    }
    return notes;
  },

  chordstream: (startMs, steps, ctx) => {
    const notes: ChartNote[] = [];
    const bases = [
      [0, 2, 4],
      [1, 3, 5],
      [2, 4, 6],
    ];
    const stride = strideOf(ctx);
    let step = 0;
    for (let i = 0; i < steps; i += stride) {
      const t = startMs + i * ctx.snapMs;
      const chord = bases[step % bases.length]!;
      for (const col of chord) pushNote(notes, col, t);
      step += 1;
    }
    return notes;
  },

  bracket: (startMs, steps, ctx) => {
    const notes: ChartNote[] = [];
    const stride = strideOf(ctx);
    let step = 0;
    for (let i = 0; i < steps; i += stride) {
      const t = startMs + i * ctx.snapMs;
      pushNote(notes, 0, t);
      pushNote(notes, 6, t);
      if (step % 2 === 1) {
        pushNote(notes, 2, t);
        pushNote(notes, 4, t);
      }
      step += 1;
    }
    return notes;
  },

  mixed: (startMs, steps, ctx) => {
    return PATTERN_EMITTERS.delay(startMs, steps, ctx);
  },
};

/**
 * Convert a fraction of rice notes to long notes.
 * Notes that fall inside a new hold on the same column are absorbed (removed)
 * so dense charts actually keep the requested LN ratio instead of aborting holds.
 */
export function applyLnRatio(
  notes: ChartNote[],
  lnRatio: number,
  beatLengthMs: number | ((note: ChartNote) => number),
  rng: () => number,
): ChartNote[] {
  if (lnRatio <= 0) return notes;

  const beatLenOf =
    typeof beatLengthMs === "function"
      ? beatLengthMs
      : (_note: ChartNote) => beatLengthMs;

  const sorted = [...notes].sort(
    (a, b) => a.startMs - b.startMs || a.column - b.column,
  );

  const holdUntil = new Map<number, number>();
  const out: ChartNote[] = [];

  for (const note of sorted) {
    const blockedUntil = holdUntil.get(note.column) ?? -Infinity;
    if (note.startMs < blockedUntil - 5) {
      continue;
    }

    if (note.endMs > note.startMs + 20) {
      out.push(note);
      holdUntil.set(note.column, Math.max(blockedUntil, note.endMs));
      continue;
    }

    if (rng() > lnRatio) {
      out.push(note);
      continue;
    }

    const localBeat = Math.max(50, beatLenOf(note));
    const holdBeats = rng() > 0.65 ? 2 : 1;
    const endMs = note.startMs + localBeat * holdBeats;

    out.push({ ...note, endMs });
    holdUntil.set(note.column, endMs);
  }

  return out;
}

