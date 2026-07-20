import type { PatternTargets } from "./types";

/**
 * 7K Sunny-dan style targets (Regular / LN).
 * Density knobs are intentionally conservative — snap 8 wall-to-wall chords
 * rates as Stellium. Prefer 1/4 with stride for mid dans.
 */
export type DanAxis = "rc" | "ln";

export type DanPreset = {
  id: string;
  /** Label matching Roxysu estDiff style, e.g. "Regular 4" / "LN 5". */
  label: string;
  axis: DanAxis;
  /** Soft mid-band Sunny★ target. */
  targetStar: number;
  snapDivisor: number;
  /** 1 = note every snap; 2 = half density, etc. */
  noteStride: number;
  segmentBeats: number;
  /** Default LN fraction (RC stays &lt;0.2, LN ≥0.2). */
  ln: number;
  patternBias: PatternTargets;
};

/** Ordered list for UI / CLI. */
export const DAN_PRESETS: DanPreset[] = [
  {
    id: "regular-0",
    label: "Regular 0",
    axis: "rc",
    targetStar: 3.9,
    snapDivisor: 4,
    noteStride: 2,
    segmentBeats: 8,
    ln: 0.05,
    patternBias: {
      delay: 0.75,
      jack: 0.1,
      chordjack: 0.05,
      chordstream: 0.05,
      bracket: 0.05,
    },
  },
  {
    id: "regular-1",
    label: "Regular 1",
    axis: "rc",
    targetStar: 4.65,
    snapDivisor: 4,
    noteStride: 2,
    segmentBeats: 8,
    ln: 0.06,
    patternBias: {
      delay: 0.65,
      jack: 0.15,
      chordjack: 0.08,
      chordstream: 0.07,
      bracket: 0.05,
    },
  },
  {
    id: "regular-2",
    label: "Regular 2",
    axis: "rc",
    targetStar: 5.2,
    snapDivisor: 4,
    noteStride: 2,
    segmentBeats: 8,
    ln: 0.08,
    patternBias: {
      delay: 0.55,
      jack: 0.2,
      chordjack: 0.1,
      chordstream: 0.1,
      bracket: 0.05,
    },
  },
  {
    id: "regular-3",
    label: "Regular 3",
    axis: "rc",
    targetStar: 5.65,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.08,
    patternBias: {
      delay: 0.5,
      jack: 0.2,
      chordjack: 0.12,
      chordstream: 0.1,
      bracket: 0.08,
    },
  },
  {
    id: "regular-4",
    label: "Regular 4",
    axis: "rc",
    targetStar: 5.9,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.1,
    patternBias: {
      delay: 0.4,
      jack: 0.25,
      chordjack: 0.15,
      chordstream: 0.12,
      bracket: 0.08,
    },
  },
  {
    id: "regular-5",
    label: "Regular 5",
    axis: "rc",
    targetStar: 6.2,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.1,
    patternBias: {
      delay: 0.35,
      jack: 0.25,
      chordjack: 0.18,
      chordstream: 0.14,
      bracket: 0.08,
    },
  },
  {
    id: "regular-6",
    label: "Regular 6",
    axis: "rc",
    targetStar: 6.75,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.1,
    patternBias: {
      delay: 0.3,
      jack: 0.28,
      chordjack: 0.2,
      chordstream: 0.14,
      bracket: 0.08,
    },
  },
  {
    id: "regular-7",
    label: "Regular 7",
    axis: "rc",
    targetStar: 7.1,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.12,
    patternBias: {
      delay: 0.25,
      jack: 0.3,
      chordjack: 0.22,
      chordstream: 0.15,
      bracket: 0.08,
    },
  },
  {
    id: "regular-8",
    label: "Regular 8",
    axis: "rc",
    targetStar: 7.5,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.12,
    patternBias: {
      delay: 0.2,
      jack: 0.32,
      chordjack: 0.25,
      chordstream: 0.15,
      bracket: 0.08,
    },
  },
  {
    id: "regular-9",
    label: "Regular 9",
    axis: "rc",
    targetStar: 7.85,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.12,
    patternBias: {
      delay: 0.15,
      jack: 0.35,
      chordjack: 0.28,
      chordstream: 0.14,
      bracket: 0.08,
    },
  },
  {
    id: "regular-10",
    label: "Regular 10",
    axis: "rc",
    targetStar: 8.3,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.14,
    patternBias: {
      delay: 0.12,
      jack: 0.35,
      chordjack: 0.3,
      chordstream: 0.15,
      bracket: 0.08,
    },
  },
  {
    id: "ln-3",
    label: "LN 3",
    axis: "ln",
    targetStar: 5.24,
    snapDivisor: 4,
    noteStride: 2,
    segmentBeats: 8,
    ln: 0.35,
    patternBias: {
      delay: 0.55,
      jack: 0.15,
      chordjack: 0.1,
      chordstream: 0.15,
      bracket: 0.05,
    },
  },
  {
    id: "ln-4",
    label: "LN 4",
    axis: "ln",
    targetStar: 5.66,
    snapDivisor: 4,
    noteStride: 2,
    segmentBeats: 8,
    ln: 0.4,
    patternBias: {
      delay: 0.5,
      jack: 0.15,
      chordjack: 0.12,
      chordstream: 0.18,
      bracket: 0.05,
    },
  },
  {
    id: "ln-5",
    label: "LN 5",
    axis: "ln",
    targetStar: 6.12,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.45,
    patternBias: {
      delay: 0.45,
      jack: 0.15,
      chordjack: 0.15,
      chordstream: 0.2,
      bracket: 0.05,
    },
  },
  {
    id: "ln-6",
    label: "LN 6",
    axis: "ln",
    targetStar: 6.7,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.5,
    patternBias: {
      delay: 0.4,
      jack: 0.18,
      chordjack: 0.15,
      chordstream: 0.22,
      bracket: 0.05,
    },
  },
  {
    id: "ln-7",
    label: "LN 7",
    axis: "ln",
    targetStar: 6.95,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.55,
    patternBias: {
      delay: 0.25,
      jack: 0.2,
      chordjack: 0.2,
      chordstream: 0.3,
      bracket: 0.05,
    },
  },
  {
    id: "ln-8",
    label: "LN 8",
    axis: "ln",
    targetStar: 7.34,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.55,
    patternBias: {
      delay: 0.2,
      jack: 0.22,
      chordjack: 0.23,
      chordstream: 0.3,
      bracket: 0.05,
    },
  },
  {
    id: "ln-9",
    label: "LN 9",
    axis: "ln",
    targetStar: 7.66,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.6,
    patternBias: {
      delay: 0.15,
      jack: 0.25,
      chordjack: 0.25,
      chordstream: 0.3,
      bracket: 0.05,
    },
  },
  {
    id: "ln-10",
    label: "LN 10",
    axis: "ln",
    targetStar: 8.28,
    snapDivisor: 4,
    noteStride: 1,
    segmentBeats: 8,
    ln: 0.6,
    patternBias: {
      delay: 0.1,
      jack: 0.28,
      chordjack: 0.27,
      chordstream: 0.3,
      bracket: 0.05,
    },
  },
];

const BY_ID = new Map(DAN_PRESETS.map((p) => [p.id, p]));
const BY_LABEL = new Map(
  DAN_PRESETS.map((p) => [p.label.toLowerCase(), p]),
);

/** Resolve a dan preset by id (`regular-4`) or label (`Regular 4`). */
export function resolveDanPreset(
  idOrLabel: string | undefined | null,
): DanPreset | null {
  if (idOrLabel == null || idOrLabel === "" || idOrLabel === "none") {
    return null;
  }
  const key = idOrLabel.trim();
  return BY_ID.get(key) ?? BY_LABEL.get(key.toLowerCase()) ?? null;
}
