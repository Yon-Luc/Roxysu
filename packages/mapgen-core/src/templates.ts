import type { ChartNote } from "@roxysu/osu-chart";
import type { PatternLabelV2 } from "@roxysu/pattern-7k";
import type { TierConstraints } from "./tierConstraints";

export type PatternContext = {
  columnCount: number;
  rng: () => number;
  /** Snapped musical hit times for this segment. */
  hitTimes: number[];
  /** Local beat length at segment start (for gap math). */
  beatMs: number;
  tier: TierConstraints;
};

export type PatternEmitter = (ctx: PatternContext) => ChartNote[];

function pushNote(
  out: ChartNote[],
  column: number,
  startMs: number,
  columnCount: number,
  endMs = startMs,
): void {
  out.push({
    column: Math.max(0, Math.min(columnCount - 1, column)),
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
  });
}

function pickCol(rng: () => number, columnCount: number, avoid?: number): number {
  for (let i = 0; i < 8; i += 1) {
    const c = Math.floor(rng() * columnCount);
    if (c !== avoid) return c;
  }
  return Math.floor(rng() * columnCount);
}

/** Emit pattern notes only on musical hit times. */
export const PATTERN_EMITTERS: Record<PatternLabelV2, PatternEmitter> = {
  delay: (ctx) => {
    const notes: ChartNote[] = [];
    const cols = [1, 3, 5, 2, 4, 0, 6, 3].map((c) => c % ctx.columnCount);
    let prev = -1;
    let run = 0;
    for (let i = 0; i < ctx.hitTimes.length; i += 1) {
      let col = cols[i % cols.length]!;
      if (col === prev) {
        run += 1;
        if (run >= ctx.tier.maxJackRun) {
          col = pickCol(ctx.rng, ctx.columnCount, prev);
          run = 1;
        }
      } else {
        run = 1;
      }
      prev = col;
      pushNote(notes, col, ctx.hitTimes[i]!, ctx.columnCount);
    }
    return notes;
  },

  jack: (ctx) => {
    const notes: ChartNote[] = [];
    let col = 2 + Math.floor(ctx.rng() * Math.max(1, ctx.columnCount - 4));
    let run = 0;
    for (const t of ctx.hitTimes) {
      run += 1;
      if (run > ctx.tier.maxJackRun) {
        col = pickCol(ctx.rng, ctx.columnCount, col);
        run = 1;
      }
      pushNote(notes, col, t, ctx.columnCount);
    }
    return notes;
  },

  chordjack: (ctx) => {
    const notes: ChartNote[] = [];
    const jackCol = Math.floor(ctx.columnCount / 2);
    const gapMs = ctx.tier.chordMinGapBeats * ctx.beatMs;
    let lastChordMs = -Infinity;
    let step = 0;
    for (const t of ctx.hitTimes) {
      const wantChord = step % 2 === 0 && t - lastChordMs >= gapMs;
      if (wantChord) {
        const left = Math.max(0, jackCol - 2);
        const right = Math.min(ctx.columnCount - 1, jackCol + 2);
        const chord = [left, right].slice(0, ctx.tier.maxChordSize);
        for (const c of new Set(chord)) {
          pushNote(notes, c, t, ctx.columnCount);
        }
        lastChordMs = t;
      } else {
        pushNote(notes, jackCol, t, ctx.columnCount);
      }
      step += 1;
    }
    return notes;
  },

  chordstream: (ctx) => {
    const notes: ChartNote[] = [];
    const bases = [
      [0, 2, 4],
      [1, 3, 5],
      [2, 4, 6],
    ].map((chord) =>
      chord
        .map((c) => c % ctx.columnCount)
        .filter((c, i, arr) => arr.indexOf(c) === i)
        .slice(0, ctx.tier.maxChordSize),
    );
    const gapMs = ctx.tier.chordMinGapBeats * ctx.beatMs;
    let lastChordMs = -Infinity;
    let step = 0;
    for (const t of ctx.hitTimes) {
      const chord = bases[step % bases.length]!;
      if (t - lastChordMs >= gapMs) {
        for (const c of chord) pushNote(notes, c, t, ctx.columnCount);
        lastChordMs = t;
      } else {
        // Single in the gap — keeps rhythm without illegal dense hands.
        pushNote(notes, chord[0]!, t, ctx.columnCount);
      }
      step += 1;
    }
    return notes;
  },

  bracket: (ctx) => {
    const notes: ChartNote[] = [];
    if (!ctx.tier.allowBracket) {
      return PATTERN_EMITTERS.delay(ctx);
    }
    const outer = [0, ctx.columnCount - 1];
    const inner = [
      Math.floor(ctx.columnCount / 2) - 1,
      Math.floor(ctx.columnCount / 2) + 1,
    ].filter((c) => c >= 0 && c < ctx.columnCount);
    let step = 0;
    for (const t of ctx.hitTimes) {
      const cols =
        step % 2 === 0
          ? outer
          : [...outer, ...inner].slice(0, ctx.tier.maxChordSize);
      for (const c of new Set(cols)) {
        pushNote(notes, c, t, ctx.columnCount);
      }
      step += 1;
    }
    return notes;
  },

  mixed: (ctx) => PATTERN_EMITTERS.delay(ctx),
};

/**
 * Convert a fraction of rice notes to long notes.
 * Same-column body notes are absorbed; respects min LN beats via beatLength.
 */
export function applyLnRatio(
  notes: ChartNote[],
  lnRatio: number,
  beatLengthMs: number | ((note: ChartNote) => number),
  rng: () => number,
  minLnBeats = 0.25,
): ChartNote[] {
  if (lnRatio <= 0) return notes;

  const beatLenOf =
    typeof beatLengthMs === "function"
      ? beatLengthMs
      : (_note: ChartNote) => beatLengthMs;

  const sorted = [...notes].sort(
    (a, b) => a.startMs - b.startMs || a.column - b.column,
  );

  const freeAt = new Map<number, number>();
  const out: ChartNote[] = [];

  for (const note of sorted) {
    const free = freeAt.get(note.column) ?? Number.NEGATIVE_INFINITY;
    if (note.startMs < free) continue;

    if (note.endMs > note.startMs + 20) {
      out.push(note);
      freeAt.set(note.column, note.endMs);
      continue;
    }

    if (rng() > lnRatio) {
      out.push({ ...note, endMs: note.startMs });
      freeAt.set(note.column, note.startMs + 1);
      continue;
    }

    const localBeat = Math.max(50, beatLenOf(note));
    const minLn = Math.max(40, Math.round(localBeat * minLnBeats));
    const holdBeats = rng() > 0.65 ? Math.max(minLnBeats * 2, 1) : Math.max(minLnBeats, 0.5);
    const endMs = note.startMs + Math.max(minLn, localBeat * holdBeats);

    out.push({ ...note, endMs });
    // Inclusive LN end — next head must be strictly after release.
    freeAt.set(note.column, endMs + 1);
  }

  return out;
}

/**
 * RC: no column left empty — reassign / add heads on unused columns at
 * existing musical times (does not invent new timestamps).
 */
export function ensureColumnCoverage(
  notes: ChartNote[],
  columnCount: number,
  hitTimes: number[],
  rng: () => number,
  maxChordSize: number,
): ChartNote[] {
  if (notes.length === 0 || hitTimes.length === 0) return notes;

  const used = new Set(notes.map((n) => n.column));
  const missing: number[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    if (!used.has(c)) missing.push(c);
  }
  if (missing.length === 0) return notes;

  const byTime = new Map<number, ChartNote[]>();
  for (const n of notes) {
    const list = byTime.get(n.startMs) ?? [];
    list.push(n);
    byTime.set(n.startMs, list);
  }

  const out = [...notes];
  for (const col of missing) {
    // Prefer a time with room in the chord.
    const candidates = hitTimes.filter((t) => {
      const chord = byTime.get(t) ?? [];
      return (
        chord.length < maxChordSize &&
        !chord.some((n) => n.column === col)
      );
    });
    const pool = candidates.length > 0 ? candidates : hitTimes;
    const t = pool[Math.floor(rng() * pool.length)]!;
    const chord = byTime.get(t) ?? [];
    if (chord.some((n) => n.column === col)) continue;
    if (chord.length >= maxChordSize) {
      // Steal from the busiest column in this chord.
      const steal = chord[Math.floor(rng() * chord.length)];
      if (!steal) continue;
      steal.column = col;
      used.add(col);
      continue;
    }
    const note = { column: col, startMs: t, endMs: t };
    out.push(note);
    chord.push(note);
    byTime.set(t, chord);
    used.add(col);
  }

  return out;
}
