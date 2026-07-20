import type { ChartNote } from "@roxysu/osu-chart";

/**
 * osu!mania ranking-criteria constraints we enforce in mapgen.
 * Source: https://osu.ppy.sh/wiki/en/Ranking_criteria/osu!mania
 */
export type SanitizeOptions = {
  /** Minimum LN length in ms. Default: max(40, beat/12). */
  minLnMs?: number | ((note: ChartNote) => number);
  /** Max simultaneous press heads (not releases). Default: 6. */
  maxChordSize?: number;
  /**
   * Minimum gap between LN *releases* (RC Easy/Normal guideline).
   * 0 = disabled.
   */
  minReleaseGapMs?: number | ((note: ChartNote) => number);
};

function isHold(note: ChartNote, minLnMs: number): boolean {
  return note.endMs > note.startMs + Math.max(20, minLnMs * 0.5);
}

function resolveMs(
  note: ChartNote,
  option: number | ((note: ChartNote) => number) | undefined,
  fallback: number,
): number {
  if (typeof option === "function") return Math.max(0, option(note));
  if (typeof option === "number") return Math.max(0, option);
  return fallback;
}

/**
 * Make a chart Auto-playable / RC-legal on a per-column basis.
 * Drops illegal overlaps; shortens/cancels too-short LNs; caps chord size;
 * optionally spaces LN releases.
 */
export function sanitizeManiaNotes(
  notes: ChartNote[],
  options: SanitizeOptions = {},
): ChartNote[] {
  const maxChord = options.maxChordSize ?? 6;
  const sorted = [...notes].sort(
    (a, b) => a.startMs - b.startMs || a.column - b.column,
  );

  const freeAt = new Map<number, number>();
  const kept: ChartNote[] = [];
  let lastReleaseMs = Number.NEGATIVE_INFINITY;

  for (const raw of sorted) {
    const minLn = resolveMs(raw, options.minLnMs, 40) || 40;
    let note: ChartNote = {
      column: raw.column,
      startMs: Math.round(raw.startMs),
      endMs: Math.round(raw.endMs),
    };

    const free = freeAt.get(note.column) ?? Number.NEGATIVE_INFINITY;
    if (note.startMs < free) continue;

    if (note.endMs > note.startMs && note.endMs - note.startMs < minLn) {
      note = { ...note, endMs: note.startMs };
    }

    let hold = isHold(note, minLn);
    if (hold) {
      const releaseGap = resolveMs(note, options.minReleaseGapMs, 0);
      if (
        releaseGap > 0 &&
        note.endMs < lastReleaseMs + releaseGap
      ) {
        // Too soon after previous release — keep as rice instead.
        note = { ...note, endMs: note.startMs };
        hold = false;
      }
    }

    if (hold) {
      kept.push(note);
      freeAt.set(note.column, note.endMs);
      lastReleaseMs = note.endMs;
    } else {
      kept.push({ ...note, endMs: note.startMs });
      freeAt.set(note.column, note.startMs + 1);
    }
  }

  if (maxChord < 7) {
    return capChordSize(kept, maxChord);
  }
  return kept.sort((a, b) => a.startMs - b.startMs || a.column - b.column);
}

function capChordSize(notes: ChartNote[], maxChord: number): ChartNote[] {
  const byTime = new Map<number, ChartNote[]>();
  for (const n of notes) {
    const list = byTime.get(n.startMs) ?? [];
    list.push(n);
    byTime.set(n.startMs, list);
  }

  const out: ChartNote[] = [];
  for (const t of [...byTime.keys()].sort((a, b) => a - b)) {
    const chord = byTime.get(t)!;
    chord.sort((a, b) => a.column - b.column);
    out.push(...chord.slice(0, maxChord));
  }
  return out;
}

/** True if any same-column overlap / duplicate timestamp exists. */
export function findIllegalOverlaps(notes: ChartNote[]): Array<{
  column: number;
  a: ChartNote;
  b: ChartNote;
  reason: string;
}> {
  const issues: Array<{
    column: number;
    a: ChartNote;
    b: ChartNote;
    reason: string;
  }> = [];

  const byCol = new Map<number, ChartNote[]>();
  for (const n of notes) {
    const list = byCol.get(n.column) ?? [];
    list.push(n);
    byCol.set(n.column, list);
  }

  for (const [column, list] of byCol) {
    const sorted = [...list].sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]!;
      const aEnd = a.endMs > a.startMs + 20 ? a.endMs : a.startMs;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j]!;
        if (b.startMs > aEnd) break;
        if (b.startMs === a.startMs) {
          issues.push({
            column,
            a,
            b,
            reason: "two notes in one column at the same timestamp",
          });
        } else if (b.startMs < aEnd) {
          issues.push({
            column,
            a,
            b,
            reason: "note overlaps long-note body on same column",
          });
        }
      }
    }
  }

  return issues;
}

/** Columns that have zero notes (RC: no column left empty). */
export function findEmptyColumns(
  notes: ChartNote[],
  columnCount: number,
): number[] {
  const used = new Set(notes.map((n) => n.column));
  const empty: number[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    if (!used.has(c)) empty.push(c);
  }
  return empty;
}
