import { parse7kChart, type ChartNote } from "@roxysu/osu-chart";
import {
  PATTERN_ALGORITHM_V2,
  type PatternLabelV2,
  type StructuralPatternResult,
} from "../types";
import {
  buildChords,
  density,
  expandChordTagsToNotes,
  isHold,
  markBrackets,
  markChordjacks,
  markChordstreams,
  markDelayRuns,
  markStructuralJacks,
  markTrills,
  noteDensity,
  SECTION_MS,
} from "./segment";

const MIN_DOMINANCE_GAP = 0.04;

type ScoredPattern = { label: PatternLabelV2; score: number };

function scorePatterns(metrics: {
  jackDensity: number;
  chordDensity: number;
  delayDensity: number;
  bracketDensity: number;
  chordjackScore: number;
  chordstreamScore: number;
  trillScore: number;
}): ScoredPattern[] {
  const jackScore =
    metrics.jackDensity * (1 - Math.min(1, metrics.chordDensity * 1.5));
  const chordjackScore =
    metrics.chordjackScore *
    (1 + metrics.jackDensity * 0.5) *
    (1 - Math.min(1, metrics.bracketDensity));
  const delayScore =
    metrics.delayDensity *
    (1 - metrics.chordDensity * 0.8) *
    (1 - metrics.trillScore * 0.3);
  const chordstreamScore =
    metrics.chordstreamScore *
    metrics.chordDensity *
    (1 - metrics.bracketDensity * 0.5);
  const bracketScore =
    metrics.bracketDensity *
    (1 + metrics.trillScore + metrics.chordDensity * 0.3);

  const scored: ScoredPattern[] = [
    { label: "jack", score: jackScore },
    { label: "chordjack", score: chordjackScore },
    { label: "delay", score: delayScore },
    { label: "chordstream", score: chordstreamScore },
    { label: "bracket", score: bracketScore },
  ];
  return scored.sort((a, b) => b.score - a.score);
}

function pickDominant(scored: ScoredPattern[]): {
  dominant: PatternLabelV2;
  secondary: PatternLabelV2 | null;
  confidence: number;
} {
  if (scored.length === 0 || scored[0]!.score <= 0) {
    return { dominant: "mixed", secondary: null, confidence: 0 };
  }

  const top = scored[0]!;
  const second = scored[1] ?? { label: "mixed" as PatternLabelV2, score: 0 };
  const gap = top.score - second.score;

  if (top.score < 0.08) {
    return { dominant: "mixed", secondary: null, confidence: top.score };
  }

  const confidence = Math.min(1, top.score + gap);
  const secondary =
    gap >= MIN_DOMINANCE_GAP && second.score >= 0.08 ? second.label : null;

  return { dominant: top.label, secondary, confidence };
}

function buildSections(
  notes: ChartNote[],
  noteTags: Record<PatternLabelV2, boolean[]>,
): StructuralPatternResult["sections"] {
  if (notes.length === 0) return [];

  const startMs = notes[0]!.startMs;
  const endMs = notes[notes.length - 1]!.startMs;
  const sections: StructuralPatternResult["sections"] = [];

  for (let t = startMs; t <= endMs; t += SECTION_MS) {
    const windowEnd = t + SECTION_MS;
    const labels: PatternLabelV2[] = [
      "jack",
      "chordjack",
      "delay",
      "chordstream",
      "bracket",
    ];
    let windowNotes = 0;
    const counts = new Map<PatternLabelV2, number>();

    for (let i = 0; i < notes.length; i += 1) {
      const note = notes[i]!;
      if (note.startMs < t || note.startMs >= windowEnd) continue;
      windowNotes += 1;
      for (const label of labels) {
        if (noteTags[label]![i]) {
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
      }
    }

    if (windowNotes === 0) continue;

    const patterns = labels
      .map((label) => ({
        label,
        coverage: (counts.get(label) ?? 0) / windowNotes,
      }))
      .filter((p) => p.coverage >= 0.05)
      .sort((a, b) => b.coverage - a.coverage);

    sections.push({ startMs: t, endMs: windowEnd, patterns });
  }

  return sections;
}

function buildComposition(
  notes: ChartNote[],
  noteTags: Record<PatternLabelV2, boolean[]>,
): StructuralPatternResult["composition"] {
  const composition: StructuralPatternResult["composition"] = {};
  const labels: PatternLabelV2[] = [
    "jack",
    "chordjack",
    "delay",
    "chordstream",
    "bracket",
  ];

  for (const label of labels) {
    composition[label] = noteDensity(notes, noteTags[label]!);
  }

  return composition;
}

/** Analyze parsed 7k chart notes with wiki-aligned structural matching (v2). */
export function analyze7kStructuralNotes(
  notes: ChartNote[],
): StructuralPatternResult {
  const rcNotes = notes.filter((n) => !isHold(n));
  if (rcNotes.length === 0) {
    return {
      algorithm: PATTERN_ALGORITHM_V2,
      columnCount: 7,
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
    };
  }

  const chords = buildChords(rcNotes);
  const jackFlags = markStructuralJacks(rcNotes);
  const delayChordFlags = markDelayRuns(chords);
  const trillChordFlags = markTrills(chords);
  const bracketFlags = markBrackets(chords, rcNotes);
  const chordstreamChordFlags = markChordstreams(chords);
  const chordjackChordFlags = markChordjacks(chords, jackFlags);

  const delayFlags = expandChordTagsToNotes(
    chords,
    delayChordFlags,
    rcNotes.length,
  );
  const chordstreamFlags = expandChordTagsToNotes(
    chords,
    chordstreamChordFlags,
    rcNotes.length,
  );
  const chordjackFlags = expandChordTagsToNotes(
    chords,
    chordjackChordFlags,
    rcNotes.length,
  );
  const trillFlags = expandChordTagsToNotes(
    chords,
    trillChordFlags,
    rcNotes.length,
  );

  const isChord = rcNotes.map((_, i) => {
    const chord = chords.find((c) => c.noteIndices.includes(i));
    return (chord?.size ?? 1) >= 2;
  });

  const metrics = {
    columnCount: 7,
    jackDensity: noteDensity(rcNotes, jackFlags),
    chordDensity: density(isChord),
    delayDensity: noteDensity(rcNotes, delayFlags),
    bracketDensity: noteDensity(rcNotes, bracketFlags),
    chordjackScore: noteDensity(rcNotes, chordjackFlags),
    chordstreamScore: noteDensity(rcNotes, chordstreamFlags),
    trillScore: noteDensity(rcNotes, trillFlags),
  };

  const scored = scorePatterns(metrics);
  const { dominant, secondary, confidence } = pickDominant(scored);

  const noteTags: Record<PatternLabelV2, boolean[]> = {
    jack: jackFlags,
    chordjack: chordjackFlags,
    delay: delayFlags,
    chordstream: chordstreamFlags,
    bracket: bracketFlags,
    mixed: new Array<boolean>(rcNotes.length).fill(false),
  };

  return {
    algorithm: PATTERN_ALGORITHM_V2,
    columnCount: metrics.columnCount,
    jackDensity: metrics.jackDensity,
    chordDensity: metrics.chordDensity,
    streamDensity: metrics.delayDensity,
    bracketDensity: metrics.bracketDensity,
    chordjackScore: metrics.chordjackScore,
    jumpstreamScore: metrics.trillScore,
    chordstreamScore: metrics.chordstreamScore,
    dominantPattern: dominant,
    secondaryPattern: secondary,
    confidence,
    sections: buildSections(rcNotes, noteTags),
    composition: buildComposition(rcNotes, noteTags),
  };
}

/** Parse `.osu` text and analyze with structural v2 matching. */
export function analyze7kStructuralFromOsuText(
  osuText: string,
): StructuralPatternResult {
  const chart = parse7kChart(osuText);
  return analyze7kStructuralNotes(chart.notes);
}
