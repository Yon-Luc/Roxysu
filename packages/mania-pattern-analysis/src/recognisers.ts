import type { RowInfo, SpecificPatterns } from "./types.js";

/**
 * Pattern recogniser functions, ported from
 * Companella/Services/Analysis/InterludePatterns/InterludePatternRecognisers.cs
 * (itself a port of YAVSRG Prelude's Patterns.fs).
 */

function sameColumns(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function at(rows: RowInfo[], index: number): RowInfo | null {
  return index >= 0 && index < rows.length ? rows[index] : null;
}

export const Core = {
  stream(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    const r3 = at(rows, 3);
    const r4 = at(rows, 4);
    if (!r0 || !r1 || !r2 || !r3 || !r4) return 0;

    if (
      r0.notes === 1 &&
      r0.jacks === 0 &&
      r1.notes === 1 &&
      r1.jacks === 0 &&
      r2.notes === 1 &&
      r2.jacks === 0 &&
      r3.notes === 1 &&
      r3.jacks === 0 &&
      r4.notes === 1 &&
      r4.jacks === 0 &&
      r0.rawNotes[0] !== r4.rawNotes[0]
    ) {
      return 5;
    }
    return 0;
  },

  jacks(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    if (!r0) return 0;
    return r0.jacks > 1 && r0.msPerBeat < 2000.0 ? 1 : 0;
  },

  chordstream(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    const r3 = at(rows, 3);
    if (!r0 || !r1 || !r2 || !r3) return 0;

    if (
      r0.notes > 1 &&
      r0.jacks === 0 &&
      r1.jacks === 0 &&
      r2.jacks === 0 &&
      r3.jacks === 0 &&
      (r1.notes > 1 || r2.notes > 1 || r3.notes > 1)
    ) {
      return 4;
    }
    return 0;
  },
};

export const Jacks = {
  chordjacks(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    if (!r0 || !r1) return 0;
    return r0.notes > 2 &&
      r1.notes > 1 &&
      r1.jacks >= 1 &&
      (r1.notes < r0.notes || r1.jacks < r0.notes)
      ? 2
      : 0;
  },

  minijacks(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    if (!r0 || !r1) return 0;
    return r0.jacks > 0 && r1.jacks === 0 ? 2 : 0;
  },

  longjacks(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    const r3 = at(rows, 3);
    const r4 = at(rows, 4);
    if (!r0 || !r1 || !r2 || !r3 || !r4) return 0;

    if (
      r0.jacks <= 0 ||
      r1.jacks <= 0 ||
      r2.jacks <= 0 ||
      r3.jacks <= 0 ||
      r4.jacks <= 0
    )
      return 0;

    for (const column of r0.rawNotes) {
      if (
        r1.rawNotes.includes(column) &&
        r2.rawNotes.includes(column) &&
        r3.rawNotes.includes(column) &&
        r4.rawNotes.includes(column)
      ) {
        return 5;
      }
    }
    return 0;
  },
};

export const Jacks4K = {
  quadstream(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r2 = at(rows, 2);
    const r3 = at(rows, 3);
    if (!r0 || !r2 || !r3) return 0;
    return r0.notes === 4 && r2.jacks === 0 && r3.jacks === 0 ? 4 : 0;
  },

  gluts(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    if (!r0 || !r1 || !r2) return 0;
    if (r1.jacks !== 1 || r2.jacks !== 1) return 0;

    for (const column of r0.rawNotes) {
      if (r1.rawNotes.includes(column) && r2.rawNotes.includes(column))
        return 0;
    }
    return 3;
  },
};

export const Chordstream4K = {
  handstream(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    const r3 = at(rows, 3);
    if (!r0 || !r1 || !r2 || !r3) return 0;
    return r0.notes === 3 &&
      r0.jacks === 0 &&
      r1.jacks === 0 &&
      r2.jacks === 0 &&
      r3.jacks === 0
      ? 4
      : 0;
  },

  jumpstream(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    const r3 = at(rows, 3);
    if (!r0 || !r1 || !r2 || !r3) return 0;
    return r0.notes === 2 &&
      r0.jacks === 0 &&
      r1.notes === 1 &&
      r1.jacks === 0 &&
      r2.notes < 3 &&
      r2.jacks === 0 &&
      r3.notes < 3 &&
      r3.jacks === 0
      ? 4
      : 0;
  },

  jumptrill(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    const r3 = at(rows, 3);
    if (!r0 || !r1 || !r2 || !r3) return 0;
    return r0.notes === 2 &&
      r1.notes === 2 &&
      r1.roll &&
      r2.notes === 2 &&
      r2.roll &&
      r3.notes === 2 &&
      r3.roll
      ? 4
      : 0;
  },

  splittrill(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    if (!r0 || !r1 || !r2) return 0;
    return r0.notes === 2 &&
      r1.notes === 2 &&
      r1.jacks === 0 &&
      !r1.roll &&
      r2.notes === 2 &&
      r2.jacks === 0 &&
      !r2.roll
      ? 3
      : 0;
  },
};

export const Stream4K = {
  roll(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    if (!r0 || !r1 || !r2) return 0;

    if (
      r0.notes === 1 &&
      r0.direction === "Left" &&
      r1.notes === 1 &&
      r1.direction === "Left" &&
      r2.notes === 1 &&
      r2.direction === "Left"
    )
      return 3;

    if (
      r0.notes === 1 &&
      r0.direction === "Right" &&
      r1.notes === 1 &&
      r1.direction === "Right" &&
      r2.notes === 1 &&
      r2.direction === "Right"
    )
      return 3;

    return 0;
  },

  trill(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    const r3 = at(rows, 3);
    if (!r0 || !r1 || !r2 || !r3) return 0;
    return sameColumns(r0.rawNotes, r2.rawNotes) &&
      sameColumns(r1.rawNotes, r3.rawNotes) &&
      r1.jacks === 0 &&
      r2.jacks === 0
      ? 4
      : 0;
  },

  minitrill(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    const r3 = at(rows, 3);
    if (!r0 || !r1 || !r2 || !r3) return 0;
    return sameColumns(r0.rawNotes, r2.rawNotes) &&
      !sameColumns(r1.rawNotes, r3.rawNotes) &&
      r1.jacks === 0 &&
      r2.jacks === 0
      ? 4
      : 0;
  },
};

const Chordstream7K = {
  doubleStreams(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    return r0?.notes === 2 && r1 && r1.notes === 2 && r1.jacks === 0 && !r1.roll
      ? 2
      : 0;
  },

  denseChordstream(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    if (!r0 || !r1) return 0;
    return r0.notes > 1 && r1.notes > 1 && r1.jacks === 0 ? 2 : 0;
  },

  lightChordstream(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    if (!r0 || !r1) return 0;
    return r0.notes > 1 && r1.notes === 1 && r1.jacks === 0 ? 2 : 0;
  },

  brackets(rows: RowInfo[]): number {
    const r0 = at(rows, 0);
    const r1 = at(rows, 1);
    const r2 = at(rows, 2);
    if (!r0 || !r1 || !r2) return 0;
    return r0.notes > 2 &&
      r1.notes > 2 &&
      r2.notes > 2 &&
      !r1.roll &&
      r1.jacks === 0 &&
      !r2.roll &&
      r2.jacks === 0 &&
      r0.notes + r1.notes + r2.notes > 9
      ? 3
      : 0;
  },
};

const ChordstreamOther = {
  doubleStreams: Chordstream7K.doubleStreams,
  denseChordstream: Chordstream7K.denseChordstream,
  lightChordstream: Chordstream7K.lightChordstream,
};

export function forKeyCount(keyCount: number): SpecificPatterns {
  if (keyCount === 4) {
    return {
      stream: [
        ["Rolls", Stream4K.roll],
        ["Trills", Stream4K.trill],
        ["Minitrills", Stream4K.minitrill],
      ],
      chordstream: [
        ["Handstream", Chordstream4K.handstream],
        ["Split Trill", Chordstream4K.splittrill],
        ["Jumptrill", Chordstream4K.jumptrill],
        ["Jumpstream", Chordstream4K.jumpstream],
      ],
      jack: [
        ["Longjacks", Jacks.longjacks],
        ["Quadstream", Jacks4K.quadstream],
        ["Gluts", Jacks4K.gluts],
        ["Chordjacks", Jacks.chordjacks],
        ["Minijacks", Jacks.minijacks],
      ],
    };
  }

  if (keyCount === 7) {
    return {
      stream: [],
      chordstream: [
        ["Brackets", Chordstream7K.brackets],
        ["Double Stream", Chordstream7K.doubleStreams],
        ["Dense Chordstream", Chordstream7K.denseChordstream],
        ["Light Chordstream", Chordstream7K.lightChordstream],
      ],
      jack: [
        ["Longjacks", Jacks.longjacks],
        ["Chordjacks", Jacks.chordjacks],
        ["Minijacks", Jacks.minijacks],
      ],
    };
  }

  return {
    stream: [],
    chordstream: [
      ["Double Stream", ChordstreamOther.doubleStreams],
      ["Dense Chordstream", ChordstreamOther.denseChordstream],
      ["Light Chordstream", ChordstreamOther.lightChordstream],
    ],
    jack: [
      ["Longjacks", Jacks.longjacks],
      ["Chordjacks", Jacks.chordjacks],
      ["Minijacks", Jacks.minijacks],
    ],
  };
}
