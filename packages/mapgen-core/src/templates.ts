import type { ChartNote } from "@roxysu/osu-chart";
import type { PatternLabelV2 } from "@roxysu/pattern-7k";

export type PatternContext = {
  columnCount: number;
  snapMs: number;
  rng: () => number;
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

export const PATTERN_EMITTERS: Record<PatternLabelV2, PatternEmitter> = {
  delay: (startMs, steps, ctx) => {
    const notes: ChartNote[] = [];
    const cols = [1, 3, 5, 2, 4, 0, 6, 3];
    for (let i = 0; i < steps; i += 1) {
      pushNote(notes, cols[i % cols.length]!, startMs + i * ctx.snapMs);
    }
    return notes;
  },

  jack: (startMs, steps, ctx) => {
    const notes: ChartNote[] = [];
    const col = 2 + Math.floor(ctx.rng() * 3);
    for (let i = 0; i < steps; i += 1) {
      pushNote(notes, col, startMs + i * ctx.snapMs);
    }
    return notes;
  },

  chordjack: (startMs, steps, ctx) => {
    const notes: ChartNote[] = [];
    const jackCol = 3;
    for (let i = 0; i < steps; i += 1) {
      const t = startMs + i * ctx.snapMs;
      if (i % 2 === 0) {
        pushNote(notes, 1, t);
        pushNote(notes, 5, t);
      } else {
        pushNote(notes, jackCol, t);
      }
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
    for (let i = 0; i < steps; i += 1) {
      const t = startMs + i * ctx.snapMs;
      const chord = bases[i % bases.length]!;
      for (const col of chord) pushNote(notes, col, t);
    }
    return notes;
  },

  bracket: (startMs, steps, ctx) => {
    const notes: ChartNote[] = [];
    for (let i = 0; i < steps; i += 1) {
      const t = startMs + i * ctx.snapMs;
      pushNote(notes, 0, t);
      pushNote(notes, 6, t);
      if (i % 2 === 1) {
        pushNote(notes, 2, t);
        pushNote(notes, 4, t);
      }
    }
    return notes;
  },

  mixed: (startMs, steps, ctx) => {
    return PATTERN_EMITTERS.delay(startMs, steps, ctx);
  },
};

/** Convert a fraction of rice notes to long notes. */
export function applyLnRatio(
  notes: ChartNote[],
  lnRatio: number,
  beatLengthMs: number,
  rng: () => number,
): ChartNote[] {
  if (lnRatio <= 0) return notes;

  return notes.map((note) => {
    if (note.endMs > note.startMs + 20) return note;
    if (rng() > lnRatio) return note;
    const holdBeats = rng() > 0.7 ? 2 : 1;
    return {
      ...note,
      endMs: note.startMs + beatLengthMs * holdBeats,
    };
  });
}
