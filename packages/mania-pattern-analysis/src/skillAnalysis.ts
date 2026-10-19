/**
 * Dominant-skill pattern analysis.
 *
 * A chart's pattern is the rework skill it leans on hardest. This adapts the
 * `mania-difficulty` skill profile to Roxysu's pattern result shape: dominant
 * and secondary label, confidence, per-window sections, and a composition of
 * how often each skill led a window.
 */

import { parseOsuChart } from "@roxysu/osu-chart";
import {
  shapeProfile,
  skillProfile,
  SKILL_LABELS,
  type ShapeProfile,
  type SkillLabel,
  type SkillStar,
} from "@roxysu/mania-difficulty";
import type { ChartNote } from "@roxysu/osu-chart";
import {
  PATTERN_ALGORITHM,
  type PatternAnalysisResult,
  type PatternComposition,
  type PatternSection,
  type StructuralPatternResult,
} from "./roxysuTypes.js";

const ZERO_DENSITIES = {
  jackDensity: 0,
  chordDensity: 0,
  streamDensity: 0,
  bracketDensity: 0,
  chordjackScore: 0,
  jumpstreamScore: 0,
  chordstreamScore: 0,
};

function densitiesOf(shape: ShapeProfile | undefined) {
  if (!shape) return { ...ZERO_DENSITIES };
  return {
    jackDensity: shape.jackDensity,
    chordDensity: shape.chordDensity,
    streamDensity: shape.streamDensity,
    bracketDensity: shape.bracketDensity,
    chordjackScore: shape.chordjackScore,
    jumpstreamScore: shape.jumpstreamScore,
    chordstreamScore: shape.chordstreamScore,
  };
}

/**
 * Note-structural densities from the difficulty row graph.
 *
 * Same walk as chart-shape labels, so a jumpstream score agrees with
 * `shapePattern`. Prefer `skillProfile().attributes.shape` when the chart
 * was already rated — this builds the graph again.
 */
export function noteDensities(notes: ChartNote[]): {
  jackDensity: number;
  chordDensity: number;
  streamDensity: number;
  bracketDensity: number;
  chordjackScore: number;
  jumpstreamScore: number;
  chordstreamScore: number;
} {
  if (notes.length === 0) return { ...ZERO_DENSITIES };
  const columnCount = notes.reduce((max, note) => Math.max(max, note.column + 1), 1);
  return densitiesOf(
    shapeProfile({
      columnCount,
      overallDifficulty: 8,
      notes: notes.map((n) => ({
        column: n.column,
        startMs: n.startMs,
        endMs: n.endMs,
      })),
    }),
  );
}

function emptyResult(columnCount: number): StructuralPatternResult {
  return {
    algorithm: PATTERN_ALGORITHM,
    columnCount,
    jackDensity: 0,
    chordDensity: 0,
    streamDensity: 0,
    bracketDensity: 0,
    chordjackScore: 0,
    jumpstreamScore: 0,
    chordstreamScore: 0,
    dominantPattern: null,
    secondaryPattern: null,
    shapePattern: null,
    secondaryShape: null,
    confidence: 0,
    sections: [],
    composition: {},
    skillStars: SKILL_LABELS.map((skill) => ({ skill, star: 0 })),
    starRating: 0,
  };
}

/** One section per time window, carrying the skills that led it. */
function buildSections(
  windows: Array<{
    startMs: number;
    endMs: number;
    skills: SkillStar[];
  }>,
): PatternSection[] {
  return windows.map((w) => {
    const total = w.skills.reduce((sum, s) => sum + s.star, 0);
    const patterns = w.skills
      .filter((s) => s.star > 0)
      .slice(0, 2)
      .map((s) => ({
        label: s.skill,
        coverage: total > 0 ? s.star / total : 0,
      }));
    return { startMs: w.startMs, endMs: w.endMs, patterns };
  });
}

/**
 * Analyze parsed notes: dominant skill plus note-structural densities.
 *
 * `sections` is empty only when `windowMs` is explicitly `null`. An omitted
 * argument means "use the default width", which is what the preview/detail
 * surface wants because it renders the timeline. Backfills must pass `null`:
 * the bin array is sized by chart duration, so it can be enormous for a
 * malformed timestamp, and a backfill discards it after persisting the
 * chart-level result. See `analyzeManiaBackfillFromOsuText`.
 */
export function analyzeManiaSkillNotes(
  notes: ChartNote[],
  keyCount: number,
  overallDifficulty = 8,
  windowMs?: number | null,
  shouldContinue?: () => boolean,
): StructuralPatternResult {
  if (notes.length === 0) return emptyResult(keyCount);

  const profile = skillProfile(
    {
      columnCount: keyCount,
      overallDifficulty,
      notes: notes.map((n) => ({
        column: n.column,
        startMs: n.startMs,
        endMs: n.endMs,
      })),
    },
    { windowMs, shouldContinue },
  );

  const shape = profile.attributes.shape;
  return {
    algorithm: PATTERN_ALGORITHM,
    columnCount: keyCount,
    ...densitiesOf(shape),
    dominantPattern: profile.dominant,
    secondaryPattern: profile.secondary,
    shapePattern: shape?.dominant ?? null,
    secondaryShape: shape?.secondary ?? null,
    confidence: profile.confidence ?? 0,
    sections: buildSections(profile.windows),
    composition: profile.composition as PatternComposition,
    skillStars: profile.skills,
    starRating: profile.starRating,
  };
}

/**
 * Parse `.osu` text and analyze with the dominant-skill algorithm.
 *
 * Bins the skill timeline at the default width. Fine for a single on-request
 * read; a backfill should use `analyzeManiaBackfillFromOsuText` instead.
 */
export function analyzeManiaSkillFromOsuText(
  osuText: string,
  keyCount?: number,
): StructuralPatternResult {
  const chart = parseOsuChart(osuText);
  if (chart.status === "NotMania" || chart.gameMode !== "3") {
    throw new Error("Beatmap mode is not mania");
  }
  if (chart.status === "Fail" || chart.columnCount <= 0) {
    throw new Error("Beatmap parse failed");
  }
  return analyzeManiaSkillNotes(
    chart.notes,
    keyCount ?? chart.columnCount,
    overallDifficultyFrom(chart),
  );
}

export type { SkillLabel, SkillStar };
export type { PatternAnalysisResult };

/** Overall difficulty from `.osu` metadata; defaults to 8 like the beatmap helper. */
export function overallDifficultyFrom(chart: {
  metaData: Record<string, string>;
}): number {
  const raw = Number(chart.metaData["OverallDifficulty"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 8;
}