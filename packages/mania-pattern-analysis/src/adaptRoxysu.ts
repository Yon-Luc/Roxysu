import type { ChartNote } from "@roxysu/osu-chart";
import { findAllPatterns } from "./engine.js";
import { parseOsuFile } from "./osuParser.js";
import type {
  CorePattern,
  HitObject,
  PatternAnalysisResult as InterludeResult,
  PatternCluster,
  PatternType,
} from "./types.js";
import {
  PATTERN_ALGORITHM_INTERLUDE,
  type PatternComposition,
  type PatternLabel,
  type PatternLabelV2,
  type PatternSection,
  type StructuralPatternResult,
} from "./roxysuTypes.js";

const SECTION_MS = 1000;
const CHORD_EPS_MS = 8;
const HOLD_EPS_MS = 20;
/** Minimum score for a runner-up to be stored as secondary (helps sparse families like bracket). */
const MIN_SECONDARY_SCORE = 0.05;

const SCORABLE_LABELS: PatternLabelV2[] = [
  "jack",
  "chordjack",
  "delay",
  "chordstream",
  "bracket",
  "jumpstream",
  "stream",
];

function isHold(note: ChartNote): boolean {
  return note.endMs > note.startMs + HOLD_EPS_MS;
}

export function chartNotesToHitObjects(notes: ChartNote[]): HitObject[] {
  return notes.map((note) => ({
    time: note.startMs,
    column: note.column,
    type: isHold(note) ? "Hold" : "Circle",
    endTime: note.endMs,
  }));
}

function labelFromDisplayName(displayName: string, corePattern: CorePattern): PatternLabel {
  switch (displayName) {
    case "Brackets":
      return "bracket";
    case "Chordjacks":
      return "chordjack";
    case "Minijacks":
    case "Longjacks":
    case "Gluts":
    case "Jacks":
      return "jack";
    case "Trills":
    case "Minitrills":
    case "Split Trill":
    case "Rolls":
      return "delay";
    case "Jumpstream":
    case "Handstream":
    case "Jump/Handstream":
    case "Jumptrill":
      return "jumpstream";
    case "Double Stream":
    case "Dense Chordstream":
    case "Light Chordstream":
    case "Chordstream":
      return "chordstream";
    case "Stream":
      return "stream";
    default:
      switch (corePattern) {
        case "Jacks":
          return "jack";
        case "Stream":
          return "stream";
        case "Chordstream":
          return "chordstream";
      }
  }
}

function labelFromPatternType(type: PatternType): PatternLabel {
  switch (type) {
    case "Jack":
    case "Minijack":
      return "jack";
    case "Chordjack":
      return "chordjack";
    case "Bracket":
      return "bracket";
    case "Trill":
    case "Roll":
      return "delay";
    case "Jumpstream":
    case "Handstream":
    case "Jump":
    case "Hand":
    case "Quad":
    case "Jumptrill":
      return "jumpstream";
    case "Stream":
      return "stream";
    default:
      return "chordstream";
  }
}

function labelFromFoundPattern(pattern: {
  specificName: string | null;
  corePattern: string;
  type: PatternType;
}): PatternLabel {
  if (pattern.specificName) {
    return labelFromDisplayName(
      pattern.specificName,
      pattern.corePattern as CorePattern,
    );
  }
  if (
    pattern.corePattern === "Stream" ||
    pattern.corePattern === "Chordstream" ||
    pattern.corePattern === "Jacks"
  ) {
    return labelFromDisplayName(
      pattern.corePattern,
      pattern.corePattern,
    );
  }
  return labelFromPatternType(pattern.type);
}

function clusterScores(
  clusters: PatternCluster[],
): Map<PatternLabel, number> {
  const scores = new Map<PatternLabel, number>();
  for (const cluster of clusters) {
    const label = labelFromDisplayName(cluster.displayName, cluster.pattern);
    scores.set(label, (scores.get(label) ?? 0) + cluster.importance);
  }
  return scores;
}

function durationScores(
  result: InterludeResult,
  durationMs: number,
): Map<PatternLabel, number> {
  const scores = new Map<PatternLabel, number>();
  if (durationMs <= 0) return scores;

  for (const patterns of Object.values(result.patterns)) {
    if (!patterns) continue;
    for (const pattern of patterns) {
      const label = labelFromFoundPattern(pattern);
      const span = Math.max(0, pattern.endTime - pattern.startTime);
      scores.set(label, (scores.get(label) ?? 0) + span);
    }
  }

  for (const [label, amount] of scores.entries()) {
    scores.set(label, amount / durationMs);
  }
  return scores;
}

function pickDominant(
  scores: Map<PatternLabel, number>,
): {
  dominant: PatternLabel;
  secondary: PatternLabel | null;
  confidence: number;
} {
  const ranked = [...scores.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0 || ranked[0]![1] <= 0) {
    return { dominant: "mixed", secondary: null, confidence: 0 };
  }

  const [topLabel, topScore] = ranked[0]!;
  const [, secondScore = 0] = ranked[1] ?? [];
  const gap = topScore - secondScore;

  if (topScore < 0.08) {
    return { dominant: "mixed", secondary: null, confidence: topScore };
  }

  const confidence = Math.min(1, topScore + gap);
  const secondary =
    ranked[1] != null && ranked[1][1] >= MIN_SECONDARY_SCORE
      ? ranked[1][0]
      : null;

  return { dominant: topLabel, secondary, confidence };
}

function chordDensity(notes: ChartNote[]): number {
  const rcNotes = notes.filter((note) => !isHold(note));
  if (rcNotes.length === 0) return 0;

  let chordNotes = 0;
  for (let i = 0; i < rcNotes.length; i += 1) {
    const anchor = rcNotes[i]!;
    let chordSize = 1;
    for (let j = i + 1; j < rcNotes.length; j += 1) {
      if (rcNotes[j]!.startMs - anchor.startMs > CHORD_EPS_MS) break;
      chordSize += 1;
    }
    if (chordSize >= 2) chordNotes += chordSize;
  }

  return chordNotes / rcNotes.length;
}

function buildComposition(
  scores: Map<PatternLabel, number>,
): PatternComposition {
  const total = SCORABLE_LABELS.reduce(
    (sum, label) => sum + (scores.get(label) ?? 0),
    0,
  );
  const composition: PatternComposition = {};
  if (total <= 0) return composition;

  for (const label of SCORABLE_LABELS) {
    const value = scores.get(label) ?? 0;
    if (value > 0) composition[label] = value / total;
  }
  return composition;
}

function buildSections(
  result: InterludeResult,
  firstNoteTimeMs: number,
  endMs: number,
): PatternSection[] {
  if (endMs <= firstNoteTimeMs) return [];

  const startMs =
    Math.floor(firstNoteTimeMs / SECTION_MS) * SECTION_MS;
  const sections: PatternSection[] = [];

  for (let t = startMs; t <= endMs; t += SECTION_MS) {
    const windowEnd = t + SECTION_MS;
    const counts = new Map<PatternLabelV2, number>();
    let coveredMs = 0;

    for (const patterns of Object.values(result.patterns)) {
      if (!patterns) continue;
      for (const pattern of patterns) {
        const absStart = firstNoteTimeMs + pattern.startTime;
        const absEnd = firstNoteTimeMs + pattern.endTime;
        const overlapStart = Math.max(t, absStart);
        const overlapEnd = Math.min(windowEnd, absEnd);
        if (overlapEnd <= overlapStart) continue;

        const label = labelFromFoundPattern(pattern) as PatternLabelV2;
        if (!SCORABLE_LABELS.includes(label)) continue;
        const overlap = overlapEnd - overlapStart;
        counts.set(label, (counts.get(label) ?? 0) + overlap);
        coveredMs += overlap;
      }
    }

    if (coveredMs <= 0) continue;

    const patterns = [...counts.entries()]
      .map(([label, amount]) => ({
        label,
        coverage: amount / coveredMs,
      }))
      .filter((entry) => entry.coverage >= 0.05)
      .sort((a, b) => b.coverage - a.coverage);

    sections.push({ startMs: t, endMs: windowEnd, patterns });
  }

  return sections;
}

function emptyResult(columnCount: number): StructuralPatternResult {
  return {
    algorithm: PATTERN_ALGORITHM_INTERLUDE,
    columnCount,
    jackDensity: 0,
    chordDensity: 0,
    streamDensity: 0,
    bracketDensity: 0,
    chordjackScore: 0,
    jumpstreamScore: 0,
    chordstreamScore: 0,
    dominantPattern: "mixed",
    secondaryPattern: null,
    confidence: 0,
    sections: [],
    composition: {},
    interludeCategory: "Unknown",
  };
}

/** Map Interlude engine output to Roxysu pattern metrics and labels. */
export function adaptInterludeResult(
  result: InterludeResult,
  notes: ChartNote[],
  keyCount: number,
): StructuralPatternResult {
  if (!result.success || notes.length === 0) {
    return emptyResult(keyCount);
  }

  const durationMs = Math.max(
    result.chartDurationMs,
    notes[notes.length - 1]!.startMs - notes[0]!.startMs,
    1,
  );
  const firstNoteTimeMs =
    result.chartFirstNoteTimeMs || notes[0]!.startMs;
  const endMs = notes[notes.length - 1]!.startMs;

  const importanceScores = clusterScores(result.interludeClusters);
  const coverageScores = durationScores(result, durationMs);

  // Prefer Interlude cluster importance for ranking, but only after labels are
  // consistent with coverage. Normalize importance so it mixes cleanly with
  // time coverage (0–1-ish), then use the same scores for dominant + weights.
  const importanceTotal = [...importanceScores.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const combined = new Map<PatternLabel, number>();
  for (const label of SCORABLE_LABELS) {
    const importance =
      importanceTotal > 0
        ? (importanceScores.get(label) ?? 0) / importanceTotal
        : 0;
    const coverage = coverageScores.get(label) ?? 0;
    combined.set(label, importance * 0.6 + coverage * 0.4);
  }

  const { dominant, secondary, confidence } = pickDominant(combined);
  const composition = buildComposition(combined);

  return {
    algorithm: PATTERN_ALGORITHM_INTERLUDE,
    columnCount: keyCount,
    jackDensity: coverageScores.get("jack") ?? 0,
    chordDensity: chordDensity(notes),
    streamDensity: coverageScores.get("delay") ?? 0,
    bracketDensity: coverageScores.get("bracket") ?? 0,
    chordjackScore: coverageScores.get("chordjack") ?? 0,
    jumpstreamScore: coverageScores.get("jumpstream") ?? 0,
    chordstreamScore: coverageScores.get("chordstream") ?? 0,
    dominantPattern: dominant,
    secondaryPattern: secondary,
    confidence,
    sections: buildSections(result, firstNoteTimeMs, endMs),
    composition,
    interludeCategory: result.interludeCategory,
  };
}

/** Analyze parsed mania chart notes with the Interlude engine. */
export function analyzeManiaStructuralNotes(
  notes: ChartNote[],
  keyCount: number,
): StructuralPatternResult {
  const hitObjects = chartNotesToHitObjects(notes);
  const interlude = findAllPatterns(hitObjects, keyCount);
  return adaptInterludeResult(interlude, notes, keyCount);
}

/** Parse `.osu` text via osu-chart and analyze with the Interlude engine. */
export function analyzeManiaStructuralFromOsuText(
  osuText: string,
  keyCount: number,
): StructuralPatternResult {
  const notes = notesFromOsuText(osuText);
  const hitObjects = chartNotesToHitObjects(notes);
  const interlude = findAllPatterns(hitObjects, keyCount);
  return adaptInterludeResult(interlude, notes, keyCount);
}

function notesFromOsuText(osuText: string): ChartNote[] {
  const { hitObjects } = parseOsuFile(osuText);
  return hitObjects.map((hit) => ({
    column: hit.column,
    startMs: hit.time,
    endMs: hit.endTime,
  }));
}
