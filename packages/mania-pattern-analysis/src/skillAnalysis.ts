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
  skillProfile,
  SKILL_LABELS,
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

/** Rows keyed by start time, each holding its sorted column list. */
function rowsOf(notes: ChartNote[]): number[][] {
  const byStart = new Map<number, number[]>();
  for (const note of notes) {
    const bucket = byStart.get(note.startMs);
    if (bucket) bucket.push(note.column);
    else byStart.set(note.startMs, [note.column]);
  }
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cols]) => cols.sort((x, y) => x - y));
}

function sharesColumn(a: number[], b: number[]): boolean {
  return a.some((col) => b.includes(col));
}

function columnShift(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  return b[0]! - a[0]!;
}

/**
 * Note-structural densities. These describe chart shape directly and are
 * independent of the skill labels.
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
  const rows = rowsOf(notes);
  if (rows.length === 0) {
    return {
      jackDensity: 0,
      chordDensity: 0,
      streamDensity: 0,
      bracketDensity: 0,
      chordjackScore: 0,
      jumpstreamScore: 0,
      chordstreamScore: 0,
    };
  }

  const chords = rows.filter((r) => r.length >= 2).length;
  let jacks = 0;
  let brackets = 0;
  let streams = 0;
  let chordjacks = 0;
  let chordstreams = 0;
  let jumps = 0;

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const cur = rows[i]!;
    const shared = sharesColumn(prev, cur);
    const shift = columnShift(prev, cur);
    const prevChord = prev.length >= 2;
    const curChord = cur.length >= 2;
    if (shared) jacks++;
    if (prevChord && curChord) {
      chordstreams++;
      if (shared) chordjacks++;
    } else if (!prevChord && !curChord) {
      // shift 0 is a same-column repeat (a jack, not a stream step)
      if (Math.abs(shift) === 1) streams++;
      else if (Math.abs(shift) >= 2) jumps++;
    }
    if (!shared && Math.abs(shift) >= 2) brackets++;
  }

  const steps = rows.length - 1;
  return {
    jackDensity: jacks / steps,
    chordDensity: chords / rows.length,
    streamDensity: streams / steps,
    bracketDensity: brackets / steps,
    chordjackScore: chordjacks / steps,
    jumpstreamScore: jumps / steps,
    chordstreamScore: chordstreams / steps,
  };
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

/** Analyze parsed notes: dominant skill, breakdown, and time sections. */
export function analyzeManiaSkillNotes(
  notes: ChartNote[],
  keyCount: number,
  overallDifficulty = 8,
  windowMs?: number,
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
    { windowMs },
  );

  return {
    algorithm: PATTERN_ALGORITHM,
    columnCount: keyCount,
    ...noteDensities(notes),
    dominantPattern: profile.dominant,
    secondaryPattern: profile.secondary,
    confidence: profile.confidence ?? 0,
    sections: buildSections(profile.windows),
    composition: profile.composition as PatternComposition,
    skillStars: profile.skills,
    starRating: profile.starRating,
  };
}

/** Parse `.osu` text and analyze with the dominant-skill algorithm. */
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
function overallDifficultyFrom(chart: {
  metaData: Record<string, string>;
}): number {
  const raw = Number(chart.metaData["OverallDifficulty"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 8;
}