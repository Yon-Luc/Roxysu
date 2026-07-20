import type { DanPreset } from "./danPresets";

/**
 * Diff-tier patterning (RC Easy→Insane ideas), keyed by dan strength — not by
 * difficulty *names*. Used to cap chords, jacks, brackets, LN length, snap.
 */
export type PatternTier = "low" | "mid" | "high";

export type TierConstraints = {
  tier: PatternTier;
  /** Max simultaneous press heads (7K Normal≈3, Hard≈4, Insane≈6). */
  maxChordSize: number;
  /** Max consecutive same-column hits before forced column change. */
  maxJackRun: number;
  allowBracket: boolean;
  allowJackPattern: boolean;
  /** Minimum LN length in beats. */
  minLnBeats: number;
  /** Minimum gap between LN releases on the same / any column (beats). */
  minReleaseGapBeats: number;
  /** Hard cap on snap divisor (4 = no denser than 1/4). */
  maxSnapDivisor: number;
  /**
   * In chord streams, minimum beats between multi-note chords
   * (singles may fill the gaps).
   */
  chordMinGapBeats: number;
  /** Onset strength quantile to keep (0–1); higher = fewer, stronger hits. */
  onsetKeepQuantile: number;
};

function tierFromStar(star: number): PatternTier {
  if (star < 5.5) return "low";
  if (star < 7.0) return "mid";
  return "high";
}

const TIER_TABLE: Record<PatternTier, TierConstraints> = {
  low: {
    tier: "low",
    maxChordSize: 3,
    maxJackRun: 2,
    allowBracket: false,
    allowJackPattern: false,
    minLnBeats: 0.5,
    minReleaseGapBeats: 0.5,
    maxSnapDivisor: 4,
    chordMinGapBeats: 1,
    onsetKeepQuantile: 0.55,
  },
  mid: {
    tier: "mid",
    maxChordSize: 4,
    maxJackRun: 3,
    allowBracket: true,
    allowJackPattern: true,
    minLnBeats: 0.25,
    minReleaseGapBeats: 0.25,
    maxSnapDivisor: 4,
    chordMinGapBeats: 1,
    onsetKeepQuantile: 0.4,
  },
  high: {
    tier: "high",
    maxChordSize: 6,
    maxJackRun: 5,
    allowBracket: true,
    allowJackPattern: true,
    minLnBeats: 1 / 12,
    minReleaseGapBeats: 0,
    maxSnapDivisor: 8,
    chordMinGapBeats: 0.5,
    onsetKeepQuantile: 0.25,
  },
};

/** Resolve patterning tier from dan preset (or freeform star). */
export function resolveTierConstraints(
  dan: DanPreset | null,
  fallbackStar = 6.0,
): TierConstraints {
  const star = dan?.targetStar ?? fallbackStar;
  return { ...TIER_TABLE[tierFromStar(star)] };
}

/** Drop pattern keys that the tier forbids (bracket / jack). */
export function filterTargetsForTier(
  targets: Record<string, number>,
  tier: TierConstraints,
): Record<string, number> {
  const out: Record<string, number> = { ...targets };
  if (!tier.allowBracket) delete out.bracket;
  if (!tier.allowJackPattern) {
    delete out.jack;
    // Keep chordjack lightly as chord+single alternation is OK for mid+;
    // for low, remove it too.
    if (tier.tier === "low") delete out.chordjack;
  }
  if (Object.keys(out).length === 0) {
    out.delay = 1;
  }
  return out;
}
