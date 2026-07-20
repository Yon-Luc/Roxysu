import type { ChartNote } from "@roxysu/osu-chart";

export const CHORD_EPS_MS = 8;
export const HOLD_EPS_MS = 20;
export const MIN_JACK_RUN = 3;
export const DELAY_MIN_CHORDS = 4;
export const DELAY_IOI_CV_MAX = 0.35;
export const SECTION_MS = 4000;

export type Chord = {
  startMs: number;
  columns: number[];
  size: number;
  noteIndices: number[];
};

export function isHold(note: ChartNote): boolean {
  return note.endMs > note.startMs + HOLD_EPS_MS;
}

export function sortedNoteOrder(notes: ChartNote[]): number[] {
  return notes
    .map((_, i) => i)
    .sort((a, b) => {
      const dt = notes[a]!.startMs - notes[b]!.startMs;
      return dt !== 0 ? dt : a - b;
    });
}

/** Group notes into simultaneous chords (notes within CHORD_EPS_MS). */
export function buildChords(notes: ChartNote[]): Chord[] {
  if (notes.length === 0) return [];

  const order = sortedNoteOrder(notes);
  const chords: Chord[] = [];

  let start = 0;
  while (start < order.length) {
    const firstIdx = order[start]!;
    const startMs = notes[firstIdx]!.startMs;
    const columns: number[] = [];
    const noteIndices: number[] = [];
    let end = start;

    while (end < order.length) {
      const idx = order[end]!;
      if (notes[idx]!.startMs - startMs > CHORD_EPS_MS) break;
      noteIndices.push(idx);
      columns.push(notes[idx]!.column);
      end += 1;
    }

    chords.push({
      startMs,
      columns: [...new Set(columns)].sort((a, b) => a - b),
      size: columns.length,
      noteIndices,
    });
    start = end;
  }

  return chords;
}

export function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 1;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/** Mark notes that belong to structural jack runs (3+ consecutive in same column). */
export function markStructuralJacks(notes: ChartNote[]): boolean[] {
  const flags = new Array<boolean>(notes.length).fill(false);
  const byCol = new Map<number, number[]>();

  for (let i = 0; i < notes.length; i += 1) {
    const col = notes[i]!.column;
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col)!.push(i);
  }

  for (const indices of byCol.values()) {
    indices.sort((a, b) => notes[a]!.startMs - notes[b]!.startMs);

    let runStart = 0;
    for (let i = 1; i <= indices.length; i += 1) {
      const prevIdx = indices[i - 1]!;
      const curIdx = i < indices.length ? indices[i]! : -1;
      const breaksRun =
        curIdx === -1 ||
        notes[curIdx]!.startMs - notes[prevIdx]!.startMs > 200;

      if (breaksRun) {
        const runLen = i - runStart;
        if (runLen >= MIN_JACK_RUN) {
          for (let j = runStart; j < i; j += 1) {
            flags[indices[j]!] = true;
          }
        }
        runStart = i;
      }
    }
  }

  return flags;
}

/** Mark chords that belong to delay runs (single-note stream at consistent IOI). */
export function markDelayRuns(chords: Chord[]): boolean[] {
  const flags = new Array<boolean>(chords.length).fill(false);

  for (let i = 0; i < chords.length; i += 1) {
    if (chords[i]!.size !== 1) continue;

    let runEnd = i;
    while (runEnd + 1 < chords.length && chords[runEnd + 1]!.size === 1) {
      runEnd += 1;
    }

    const runLen = runEnd - i + 1;
    if (runLen >= DELAY_MIN_CHORDS) {
      const iois: number[] = [];
      for (let j = i + 1; j <= runEnd; j += 1) {
        iois.push(chords[j]!.startMs - chords[j - 1]!.startMs);
      }
      if (coefficientOfVariation(iois) <= DELAY_IOI_CV_MAX) {
        for (let j = i; j <= runEnd; j += 1) flags[j] = true;
      }
    }

    i = runEnd;
  }

  return flags;
}

/** Mark chords that form trills (alternating two columns in a single-note stream). */
export function markTrills(chords: Chord[]): boolean[] {
  const flags = new Array<boolean>(chords.length).fill(false);

  for (let i = 0; i < chords.length - 3; i += 1) {
    if (chords[i]!.size !== 1) continue;

    const colA = chords[i]!.columns[0]!;
    const colB = chords[i + 1]!.columns[0]!;
    if (colA === colB) continue;

    let len = 0;
    for (let j = i; j < chords.length; j += 1) {
      if (chords[j]!.size !== 1) break;
      const expected = len % 2 === 0 ? colA : colB;
      if (chords[j]!.columns[0] !== expected) break;
      len += 1;
    }

    if (len >= 4) {
      for (let j = i; j < i + len; j += 1) flags[j] = true;
    }
  }

  return flags;
}

const BRACKET_PAIRS: Array<[number, number]> = [
  [0, 6],
  [1, 5],
  [2, 4],
];

/** Mark notes involved in bracket patterns (simultaneous outer-column pairs + trills). */
export function markBrackets(
  chords: Chord[],
  notes: ChartNote[],
): boolean[] {
  const flags = new Array<boolean>(notes.length).fill(false);
  const trillChords = markTrills(chords);

  for (const chord of chords) {
    if (chord.size < 2) continue;
    for (const [left, right] of BRACKET_PAIRS) {
      if (chord.columns.includes(left) && chord.columns.includes(right)) {
        for (const idx of chord.noteIndices) flags[idx] = true;
      }
    }
  }

  for (let i = 0; i < chords.length; i += 1) {
    if (!trillChords[i]) continue;
    const windowEnd = chords[i]!.startMs + 120;
    let parallelTrills = 0;
    for (let j = i; j < chords.length && chords[j]!.startMs <= windowEnd; j += 1) {
      if (trillChords[j]) parallelTrills += 1;
    }
    if (parallelTrills >= 3) {
      for (let j = i; j < chords.length && chords[j]!.startMs <= windowEnd; j += 1) {
        if (trillChords[j]) {
          for (const idx of chords[j]!.noteIndices) flags[idx] = true;
        }
      }
    }
  }

  return flags;
}

/** Mark chords in chordstream runs (multi-note chords in a consistent stream). */
export function markChordstreams(chords: Chord[]): boolean[] {
  const flags = new Array<boolean>(chords.length).fill(false);

  for (let i = 0; i < chords.length; i += 1) {
    if (chords[i]!.size < 2) continue;

    let runEnd = i;
    let multiCount = 0;
    while (runEnd < chords.length) {
      if (chords[runEnd]!.size >= 2) multiCount += 1;
      if (runEnd + 1 < chords.length) {
        const ioi = chords[runEnd + 1]!.startMs - chords[runEnd]!.startMs;
        if (ioi > 250) break;
      }
      runEnd += 1;
      if (runEnd - i + 1 >= 6 && multiCount >= 3) break;
    }

    const runLen = runEnd - i + 1;
    if (runLen >= 4 && multiCount >= 2) {
      for (let j = i; j <= runEnd; j += 1) flags[j] = true;
    }

    i = Math.max(i + 1, runEnd);
  }

  return flags;
}

/** Mark chords in dense jack+chord regions (chordjack). */
export function markChordjacks(
  chords: Chord[],
  jackFlags: boolean[],
): boolean[] {
  const flags = new Array<boolean>(chords.length).fill(false);

  for (let i = 0; i < chords.length; i += 1) {
    const chord = chords[i]!;
    if (chord.size < 2) continue;

    let jackHits = 0;
    for (const idx of chord.noteIndices) {
      if (jackFlags[idx]) jackHits += 1;
    }

    const jackInWindow = chord.noteIndices.some((idx) => jackFlags[idx]);
    if (!jackInWindow) {
      const windowStart = chord.startMs - 100;
      const windowEnd = chord.startMs + 100;
      for (let j = 0; j < chords.length; j += 1) {
        const other = chords[j]!;
        if (other.startMs < windowStart || other.startMs > windowEnd) continue;
        for (const idx of other.noteIndices) {
          if (jackFlags[idx]) jackHits += 1;
        }
      }
    }

    if (jackHits >= 2 || (jackInWindow && chord.size >= 3)) {
      flags[i] = true;
    }
  }

  return flags;
}

export function density(flags: boolean[]): number {
  if (flags.length === 0) return 0;
  let n = 0;
  for (const f of flags) if (f) n += 1;
  return n / flags.length;
}

export function noteDensity(notes: ChartNote[], flags: boolean[]): number {
  if (notes.length === 0) return 0;
  let n = 0;
  for (const f of flags) if (f) n += 1;
  return n / notes.length;
}

export function expandChordTagsToNotes(
  chords: Chord[],
  chordFlags: boolean[],
  notesLen: number,
): boolean[] {
  const flags = new Array<boolean>(notesLen).fill(false);
  for (let i = 0; i < chords.length; i += 1) {
    if (!chordFlags[i]) continue;
    for (const idx of chords[i]!.noteIndices) flags[idx] = true;
  }
  return flags;
}
