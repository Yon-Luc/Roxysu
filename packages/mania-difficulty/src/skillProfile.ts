/**
 * Time-binned skill profile for a chart.
 *
 * The star rating gives one number per skill for the whole map. This bins the
 * per-note strain into fixed windows so a chart can be described over time:
 * which skill is hardest in each stretch, and how often each skill leads.
 */

import type { ManiaBeatmapInput, ManiaDifficultyAttributes } from "./types";
import { calculateWithSkills, type SkillStrainSnapshot } from "./skills/calculator";
import {
  dominantSkill,
  SKILL_LABELS,
  type DominantSkill,
  type SkillLabel,
  type SkillStar,
} from "./skills";

/** Default bin width. Roughly a phrase at mid-tempo. */
export const DEFAULT_SKILL_WINDOW_MS = 2000;
const MIN_WINDOW_MS = 250;

/**
 * Hard cap on window count (2 hours at the default width).
 *
 * A chart with a bogus end timestamp — editor junk, a note far in the future —
 * would otherwise allocate millions of windows and exhaust memory, which reads
 * as a leak rather than bad input. Windows past the cap are folded into the last
 * one; dominant skill and its star ratings are unaffected either way.
 */
export const MAX_SKILL_WINDOWS = 3600;

const SNAPSHOT_KEYS = {
  speed: "speed",
  jack: "jack",
  coordination: "coordination",
  technical: "technical",
  release: "release",
} as const satisfies Record<SkillLabel, keyof SkillStrainSnapshot>;

export type SkillWindow = {
  startMs: number;
  endMs: number;
  /** Peak strain per skill in this window, sorted highest first. */
  skills: SkillStar[];
  /** Skill holding the highest peak; null for a window with no strain. */
  dominant: SkillLabel | null;
  /** Lead of the winner over the runner-up, 0–1. */
  dominance: number;
};

export type SkillProfile = DominantSkill & {
  /** Full calculator result, so callers need only one pass. */
  attributes: ManiaDifficultyAttributes;
  /** Chart star rating the skills came from. */
  starRating: number;
  /** Every skill's star, sorted highest first. */
  skills: SkillStar[];
  /** Each skill's share of the windows it led, plus a chart-wide total. */
  composition: Partial<Record<SkillLabel | "total", number>>;
  windows: SkillWindow[];
  windowMs: number;
};

function rank(skills: SkillStar[]): SkillStar[] {
  return [...skills].sort((a, b) => {
    if (b.star !== a.star) return b.star - a.star;
    return SKILL_LABELS.indexOf(a.skill) - SKILL_LABELS.indexOf(b.skill);
  });
}

function pickWindowDominant(skills: SkillStar[]): SkillWindow["dominant"] {
  const top = rank(skills)[0];
  return top && top.star > 0 ? top.skill : null;
}

/**
 * Classify a chart's skills, optionally binning them over time.
 *
 * `dominant`/`secondary`/`confidence` always describe the whole chart from the
 * real skill star ratings. Pass `windowMs: null` to skip binning entirely —
 * backfills only persist the chart-level result, and the bin array is sized by
 * chart duration, so a malformed timestamp could otherwise allocate millions
 * of windows.
 */
export function skillProfile(
  beatmap: ManiaBeatmapInput,
  options?: {
    windowMs?: number | null;
    clockRate?: number;
    /** Backfill guard. Omitted for a single on-request read. */
    shouldContinue?: () => boolean;
  },
): SkillProfile {
  const withWindows = options?.windowMs !== null;
  const windowMs = Math.max(
    MIN_WINDOW_MS,
    options?.windowMs ?? DEFAULT_SKILL_WINDOW_MS,
  );

  if (beatmap.notes.length === 0) {
    return {
      attributes: {
        starRating: 0,
        noteCount: 0,
        holdNoteCount: 0,
        overallDifficulty: beatmap.overallDifficulty,
        lnRatio: 0,
      },
      starRating: 0,
      dominant: null,
      secondary: null,
      confidence: null,
      skills: rank(
        SKILL_LABELS.map((skill) => ({ skill, star: 0 })),
      ),
      composition: {},
      windows: [],
      windowMs,
    };
  }

  if (!withWindows) {
    // Chart-level classification only: no per-window state at all.
    const attributes = calculateWithSkills(beatmap, {
      clockRate: options?.clockRate ?? 1,
      shouldContinue: options?.shouldContinue,
    });
    const classified = dominantSkill(attributes);
    return {
      attributes,
      starRating: attributes.starRating,
      dominant: classified.dominant,
      secondary: classified.secondary,
      confidence: classified.confidence,
      skills: classified.skills,
      composition: {},
      windows: [],
      windowMs,
    };
  }

  const first = beatmap.notes[0]!.startMs;
  const spanWindows =
    Math.floor(
      (beatmap.notes[beatmap.notes.length - 1]!.startMs - first) / windowMs,
    ) + 1;
  // Pre-seed every window across the whole chart so quiet stretches still show,
  // clamped so malformed input cannot blow up memory.
  const windowCount = Math.max(1, Math.min(spanWindows, MAX_SKILL_WINDOWS));
  const windowIndexScale = spanWindows / windowCount;
  const peaks: SkillStar[][] = Array.from({ length: windowCount }, () =>
    SKILL_LABELS.map((skill) => ({ skill, star: 0 })),
  );

  const attributes = calculateWithSkills(beatmap, {
    clockRate: options?.clockRate ?? 1,
    shouldContinue: options?.shouldContinue,
    onObject(snapshot) {
      const raw = Math.floor(
        (snapshot.startTime - first) / windowMs,
      );
      const idx = Math.max(
        0,
        Math.min(
          windowCount - 1,
          windowIndexScale === 1 ? raw : Math.floor(raw * windowIndexScale),
        ),
      );
      const bucket = peaks[idx]!;
      for (const skill of SKILL_LABELS) {
        const entry = bucket[SKILL_LABELS.indexOf(skill)]!;
        const value = snapshot[SNAPSHOT_KEYS[skill]];
        if (value > entry.star) entry.star = value;
      }
    },
  });

  const windows: SkillWindow[] = peaks.map((peaksInWindow, i) => {
    const sorted = rank(peaksInWindow);
    const top = sorted[0];
    const runnerUp = sorted[1];
    return {
      startMs: first + i * windowMs,
      endMs: first + (i + 1) * windowMs,
      skills: sorted,
      dominant: pickWindowDominant(sorted),
      dominance:
        top && runnerUp && top.star > 0
          ? Math.min(1, Math.max(0, (top.star - runnerUp.star) / top.star))
          : 0,
    };
  });

  const leads: Partial<Record<SkillLabel, number>> = {};
  for (const skill of SKILL_LABELS) leads[skill] = 0;
  for (const w of windows) {
    if (w.dominant) leads[w.dominant] = (leads[w.dominant] ?? 0) + 1;
  }
  const composition: Partial<Record<SkillLabel | "total", number>> = {};
  for (const skill of SKILL_LABELS) {
    composition[skill] = windows.length > 0 ? leads[skill]! / windows.length : 0;
  }
  // Shares sum to 1 unless a window had no strain at all.
  composition.total = SKILL_LABELS.reduce(
    (sum, skill) => sum + (composition[skill] ?? 0),
    0,
  );

  const classified = dominantSkill(attributes);
  return {
    attributes,
    starRating: attributes.starRating,
    dominant: classified.dominant,
    secondary: classified.secondary,
    confidence: classified.confidence,
    skills: classified.skills,
    composition,
    windows,
    windowMs,
  };
}