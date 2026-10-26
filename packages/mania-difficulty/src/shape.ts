/**
 * Chart-shape families counted from the mania difficulty row graph.
 *
 * These are column patterns (jumpstream, trill, …). They sit beside the five
 * dominant-skill labels and do not change star rating.
 */

import { SECONDARY_SKILL_RATIO } from "./skills";

/**
 * Family labels, in canonical tie-break order (earlier wins a tie).
 *
 * `anchor`, `shield`, and `tech` are parallel families: the row walk does not
 * claim them. They are promoted in {@link shapeProfileFromWalk} when the chart
 * is built from them, and they never win a count tie over a walk family.
 */
export const SHAPE_LABELS = [
  "trill",
  "jumptrill",
  "chordjack",
  "bracket",
  "handstream",
  "jumpstream",
  "chordstream",
  "stream",
  "anchor",
  "shield",
  "tech",
] as const;

/** Families the row walk assigns. The other three are promoted after the walk. */
const WALK_LABELS: readonly ShapeLabel[] = [
  "trill",
  "jumptrill",
  "chordjack",
  "bracket",
  "handstream",
  "jumpstream",
  "chordstream",
  "stream",
];

export type ShapeLabel = (typeof SHAPE_LABELS)[number];

/**
 * Chart-shape families valid for a key count, in display order.
 *
 * Per the osu! wiki pattern index (`Beatmap/Pattern/osu!mania`): jumpstream and
 * handstream are 4K terms (a stream involving jumps/hands), so they cannot be a
 * 7K chart shape. Bracket and chordstream belong to non-4K keymodes — outside
 * 4K, chordstream names chords of 3+ notes. Single-note stream, trill,
 * jumptrill and chordjack exist on every key count. Anchor, shield, and tech
 * are not keymode-exclusive (wiki Anchor and Hold note pages).
 */
const SHAPE_LABELS_4K = [
  "stream",
  "trill",
  "jumptrill",
  "jumpstream",
  "handstream",
  "chordjack",
  "anchor",
  "chordstream",
  "shield",
  "tech",
] as const;

const SHAPE_LABELS_NON4K = [
  "stream",
  "trill",
  "jumptrill",
  "chordjack",
  "anchor",
  "chordstream",
  "bracket",
  "shield",
  "tech",
] as const;

/** Chart-shape families that may label a chart on the given key count. */
export function shapesForKeyCount(
  keyCount: number | null | undefined,
): readonly ShapeLabel[] {
  return keyCount === 4 ? SHAPE_LABELS_4K : SHAPE_LABELS_NON4K;
}

/** True when the family may label a chart on the given key count. */
export function isShapeLabelForKeyCount(
  keyCount: number | null | undefined,
  label: string,
): boolean {
  return (shapesForKeyCount(keyCount) as readonly string[]).includes(label);
}

export type ShapeDensities = {
  jackDensity: number;
  chordDensity: number;
  streamDensity: number;
  bracketDensity: number;
  chordjackScore: number;
  jumpstreamScore: number;
  chordstreamScore: number;
};

/** One linear walk over the difficulty rows, before they are released. */
export type ShapeWalk = {
  rowCount: number;
  stepCount: number;
  chordRows: number;
  /** Steps that share a column with the previous row. */
  jackSteps: number;
  /** Notes in the chart, including rows the walk left unlabeled. */
  totalNotes: number;
  /** Hold heads. Shield promotion is a share of these. */
  holdHeads: number;
  /** Consecutive shields and reverse shields. */
  shieldHits: number;
  /**
   * Most times one column sat in three consecutive rows at a similar snap.
   * Compared with {@link stepCount} for the anchor bar.
   */
  anchorPairs: number;
  /** Notes in that column. Compared with {@link totalNotes}. */
  anchorColumnNotes: number;
  counts: Record<ShapeLabel, number>;
};

/** One column on at least half of the steps, and at least this share of notes. */
const ANCHOR_PAIR_SHARE = 0.5;
const ANCHOR_NOTE_SHARE = 0.35;
/** Shielded holds, and those steps as a share of every note. */
const SHIELD_HOLD_SHARE = 0.5;
const SHIELD_NOTE_SHARE = 0.25;
/** Tech: no walk family leads, and several are actually present. */
const TECH_MAX_LEAD = 0.4;
const TECH_MIN_FAMILY = 0.12;
const TECH_MIN_NOTES = 32;
const TECH_MIN_FAMILIES = 3;

export type ShapeProfile = ShapeDensities & {
  dominant: ShapeLabel | null;
  /** Runner-up when it is at least {@link SECONDARY_SKILL_RATIO} of the top. */
  secondary: ShapeLabel | null;
  /** 0 = two shapes tied, 1 = a single shape dominates. Null when nothing scored. */
  confidence: number | null;
  counts: Record<ShapeLabel, number>;
};

export function emptyShapeCounts(): Record<ShapeLabel, number> {
  return {
    trill: 0,
    jumptrill: 0,
    chordjack: 0,
    bracket: 0,
    handstream: 0,
    jumpstream: 0,
    chordstream: 0,
    stream: 0,
    anchor: 0,
    shield: 0,
    tech: 0,
  };
}

export function emptyShapeProfile(): ShapeProfile {
  return {
    dominant: null,
    secondary: null,
    confidence: null,
    counts: emptyShapeCounts(),
    jackDensity: 0,
    chordDensity: 0,
    streamDensity: 0,
    bracketDensity: 0,
    chordjackScore: 0,
    jumpstreamScore: 0,
    chordstreamScore: 0,
  };
}

/** True when `value` is one of the chart-shape families. */
export function isShapeLabel(value: string): value is ShapeLabel {
  return (SHAPE_LABELS as readonly string[]).includes(value);
}

function share(count: number, steps: number): number {
  return steps > 0 ? count / steps : 0;
}

function noteTotal(counts: ShapeWalk["counts"]): number {
  let total = 0;
  for (const shape of WALK_LABELS) total += counts[shape];
  return total;
}

function rankedWalk(counts: ShapeWalk["counts"]) {
  return WALK_LABELS.map((shape) => ({
    shape,
    count: counts[shape],
  }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return SHAPE_LABELS.indexOf(a.shape) - SHAPE_LABELS.indexOf(b.shape);
    });
}

/**
 * Shield, then anchor, then tech. A specific structure beats a mix, and a mix
 * only replaces a walk family that does not actually lead.
 */
function promotedShape(walk: ShapeWalk, notes: number): ShapeLabel | null {
  if (
    walk.holdHeads > 0 &&
    walk.shieldHits / walk.holdHeads >= SHIELD_HOLD_SHARE &&
    walk.totalNotes > 0 &&
    walk.shieldHits / walk.totalNotes >= SHIELD_NOTE_SHARE
  ) {
    return "shield";
  }
  if (
    walk.stepCount > 0 &&
    walk.anchorPairs / walk.stepCount >= ANCHOR_PAIR_SHARE &&
    walk.totalNotes > 0 &&
    walk.anchorColumnNotes / walk.totalNotes >= ANCHOR_NOTE_SHARE
  ) {
    return "anchor";
  }
  if (notes < TECH_MIN_NOTES) return null;
  const ranked = rankedWalk(walk.counts);
  const top = ranked[0];
  if (!top || top.count / notes >= TECH_MAX_LEAD) return null;
  const present = ranked.filter(
    (entry) => entry.count / notes >= TECH_MIN_FAMILY,
  ).length;
  return present >= TECH_MIN_FAMILIES ? "tech" : null;
}

/** Dominant and secondary shape from a finished row walk. */
export function shapeProfileFromWalk(walk: ShapeWalk): ShapeProfile {
  const steps = walk.stepCount;
  const notes = noteTotal(walk.counts);
  const densities: ShapeDensities = {
    jackDensity: share(walk.jackSteps, steps),
    chordDensity: walk.rowCount > 0 ? walk.chordRows / walk.rowCount : 0,
    streamDensity: share(walk.counts.stream, notes),
    bracketDensity: share(walk.counts.bracket, notes),
    chordjackScore: share(walk.counts.chordjack, notes),
    jumpstreamScore: share(walk.counts.jumpstream, notes),
    chordstreamScore: share(walk.counts.chordstream, notes),
  };

  const ranked = rankedWalk(walk.counts);
  const top = ranked[0];
  const promoted = promotedShape(walk, notes);
  if (!top && !promoted) {
    return {
      dominant: null,
      secondary: null,
      confidence: null,
      counts: walk.counts,
      ...densities,
    };
  }

  if (promoted) {
    return {
      dominant: promoted,
      secondary: top?.shape ?? null,
      confidence: top ? Math.min(1, Math.max(0, 1 - top.count / Math.max(notes, 1))) : 1,
      counts: walk.counts,
      ...densities,
    };
  }

  const runnerUp = ranked[1];
  const secondary =
    runnerUp && runnerUp.count >= SECONDARY_SKILL_RATIO * top!.count
      ? runnerUp.shape
      : null;
  const confidence =
    runnerUp && runnerUp.count > 0
      ? Math.min(1, Math.max(0, (top!.count - runnerUp.count) / top!.count))
      : 1;

  return {
    dominant: top!.shape,
    secondary,
    confidence,
    counts: walk.counts,
    ...densities,
  };
}
