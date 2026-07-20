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

/** Convert a fraction of rice notes to long notes. */
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

  // Avoid stacking holds that would collide on the same column.
  const byColumn = new Map<number, ChartNote[]>();
  for (const note of notes) {
    const list = byColumn.get(note.column) ?? [];
    list.push(note);
    byColumn.set(note.column, list);
  }
  for (const list of byColumn.values()) {
    list.sort((a, b) => a.startMs - b.startMs);
  }

  return notes.map((note) => {
    if (note.endMs > note.startMs + 20) return note;
    if (rng() > lnRatio) return note;

    const localBeat = beatLenOf(note);
    const holdBeats = rng() > 0.7 ? 2 : 1;
    let endMs = note.startMs + localBeat * holdBeats;

    const colNotes = byColumn.get(note.column) ?? [];
    const idx = colNotes.findIndex(
      (n) => n.startMs === note.startMs && n.column === note.column,
    );
    const next = idx >= 0 ? colNotes[idx + 1] : undefined;
    if (next && endMs >= next.startMs - 10) {
      endMs = Math.max(
        note.startMs,
        next.startMs - Math.round(localBeat / 4),
      );
    }
    if (endMs <= note.startMs + 20) return note;

    return {
      ...note,
      endMs,
    };
  });
}
