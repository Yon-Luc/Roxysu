import type { Db } from "@roxysu/db/types";
import { beatmapPatternAnalysis, beatmaps } from "@roxysu/db/schema";
import { readFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";

import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import {
  analyzeManiaFromOsuText,
  analyzeManiaStructuralNotes,
  PATTERN_ALGORITHM,
  type PatternLabel,
  type PatternLabelV2,
} from "@roxysu/mania-pattern-analysis";
import { parseOsuChart, type ChartNote } from "@roxysu/osu-chart";
import { toIso as toIsoNullable } from "../shared/serialize";

export { PATTERN_ALGORITHM };

export type PatternAnalysisRating = {
  algorithm: typeof PATTERN_ALGORITHM;
  beatmapHash: string | null;
  columnCount: number | null;
  dominantPattern: PatternLabel | null;
  secondaryPattern: PatternLabel | null;
  confidence: number | null;
  jackDensity: number | null;
  chordDensity: number | null;
  streamDensity: number | null;
  bracketDensity: number | null;
  chordjackScore: number | null;
  jumpstreamScore: number | null;
  chordstreamScore: number | null;
  error: string | null;
  updatedAt: string;
  cached: boolean;
};

type ManiaPatternBreakdown = Record<
  | "jack"
  | "chordjack"
  | "delay"
  | "chordstream"
  | "bracket"
  | "jumpstream"
  | "handstream"
  | "stream",
  number
>;

/** @deprecated Use ManiaPatternBreakdown */
type SevenKPatternBreakdown = ManiaPatternBreakdown;

export type SevenKDensitySample = {
  startMs: number;
  endMs: number;
  midpointMs: number;
  noteCount: number;
  notesPerSecond: number;
  peakChordSize: number;
  dominantPattern: PatternLabelV2 | null;
  secondaryPattern: PatternLabelV2 | null;
  composition: SevenKPatternBreakdown;
};

export type SevenKPatternHotspot = {
  startMs: number;
  endMs: number;
  noteCount: number;
  notesPerSecond: number;
  dominantPattern: PatternLabelV2 | null;
  secondaryPattern: PatternLabelV2 | null;
  dominantCoverage: number;
};

export type ManiaPatternDetail = {
  algorithm: typeof PATTERN_ALGORITHM;
  columnCount: number | null;
  noteCount: number;
  holdCount: number;
  durationMs: number;
  averageNps: number;
  peakNps: number;
  peakChordSize: number;
  dominantPattern: PatternLabel | null;
  secondaryPattern: PatternLabel | null;
  confidence: number | null;
  composition: SevenKPatternBreakdown;
  samples: SevenKDensitySample[];
  hotspots: SevenKPatternHotspot[];
  error: string | null;
};

/** @deprecated Use ManiaPatternDetail */
export type SevenKPatternDetail = ManiaPatternDetail;

const EMPTY_BREAKDOWN: ManiaPatternBreakdown = {
  jack: 0,
  chordjack: 0,
  delay: 0,
  chordstream: 0,
  bracket: 0,
  jumpstream: 0,
  handstream: 0,
  stream: 0,
};

const DENSITY_SAMPLE_MS = 1000;
const CHORD_EPS_MS = 8;

function normalizeBreakdown(
  partial?: Partial<Record<PatternLabelV2, number>>,
): ManiaPatternBreakdown {
  return {
    jack: partial?.jack ?? 0,
    chordjack: partial?.chordjack ?? 0,
    delay: partial?.delay ?? 0,
    chordstream: partial?.chordstream ?? 0,
    bracket: partial?.bracket ?? 0,
    jumpstream: partial?.jumpstream ?? 0,
    handstream: partial?.handstream ?? 0,
    stream: partial?.stream ?? 0,
  };
}

function emptyManiaPatternDetail(error: string): ManiaPatternDetail {
  return {
    algorithm: PATTERN_ALGORITHM,
    columnCount: null,
    noteCount: 0,
    holdCount: 0,
    durationMs: 0,
    averageNps: 0,
    peakNps: 0,
    peakChordSize: 0,
    dominantPattern: null,
    secondaryPattern: null,
    confidence: null,
    composition: { ...EMPTY_BREAKDOWN },
    samples: [],
    hotspots: [],
    error,
  };
}

function buildDensitySamples(notes: ChartNote[], sections: Array<{
  startMs: number;
  endMs: number;
  patterns: Array<{ label: PatternLabelV2; coverage: number }>;
}>): SevenKDensitySample[] {
  if (notes.length === 0) return [];

  const startMs =
    Math.floor(notes[0]!.startMs / DENSITY_SAMPLE_MS) * DENSITY_SAMPLE_MS;
  const endMs =
    Math.ceil(notes[notes.length - 1]!.startMs / DENSITY_SAMPLE_MS) *
    DENSITY_SAMPLE_MS;
  const samples: SevenKDensitySample[] = [];

  for (let t = startMs; t <= endMs; t += DENSITY_SAMPLE_MS) {
    const windowEnd = t + DENSITY_SAMPLE_MS;
    const windowNotes = notes.filter(
      (note) => note.startMs >= t && note.startMs < windowEnd,
    );
    let peakChordSize = 0;
    for (let i = 0; i < windowNotes.length; i += 1) {
      const anchor = windowNotes[i]!;
      let chordSize = 1;
      for (let j = i + 1; j < windowNotes.length; j += 1) {
        if (windowNotes[j]!.startMs - anchor.startMs > CHORD_EPS_MS) break;
        chordSize += 1;
      }
      peakChordSize = Math.max(peakChordSize, chordSize);
    }

    const midpointMs = t + DENSITY_SAMPLE_MS / 2;
    const section = sections.find(
      (candidate) =>
        midpointMs >= candidate.startMs && midpointMs < candidate.endMs,
    );
    const composition = normalizeBreakdown(
      Object.fromEntries(
        (section?.patterns ?? []).map((pattern) => [pattern.label, pattern.coverage]),
      ) as Partial<Record<PatternLabelV2, number>>,
    );

    samples.push({
      startMs: t,
      endMs: windowEnd,
      midpointMs,
      noteCount: windowNotes.length,
      notesPerSecond: windowNotes.length / (DENSITY_SAMPLE_MS / 1000),
      peakChordSize,
      dominantPattern: section?.patterns[0]?.label ?? null,
      secondaryPattern: section?.patterns[1]?.label ?? null,
      composition,
    });
  }

  return samples;
}

function buildHotspots(samples: SevenKDensitySample[]): SevenKPatternHotspot[] {
  return [...samples]
    .filter((sample) => sample.noteCount > 0)
    .map((sample) => ({
      startMs: sample.startMs,
      endMs: sample.endMs,
      noteCount: sample.noteCount,
      notesPerSecond: sample.notesPerSecond,
      dominantPattern: sample.dominantPattern,
      secondaryPattern: sample.secondaryPattern,
      dominantCoverage:
        sample.dominantPattern != null
          ? sample.dominantPattern === "mixed"
            ? 0
            : (sample.composition[sample.dominantPattern as keyof ManiaPatternBreakdown] ??
              0)
          : 0,
    }))
    .sort((a, b) => {
      if (b.notesPerSecond !== a.notesPerSecond) {
        return b.notesPerSecond - a.notesPerSecond;
      }
      return b.dominantCoverage - a.dominantCoverage;
    })
    .slice(0, 5);
}

function analyzeManiaPatternDetail(osuText: string): ManiaPatternDetail {
  const chart = parseOsuChart(osuText);
  if (chart.status === "NotMania" || chart.gameMode !== "3") {
    throw new Error("Beatmap mode is not mania");
  }
  if (chart.status === "Fail" || chart.columnCount <= 0) {
    throw new Error("Beatmap parse failed");
  }

  const result = analyzeManiaStructuralNotes(chart.notes, chart.columnCount);
  const holdCount = chart.notes.filter((note) => note.endMs > note.startMs).length;
  const samples = buildDensitySamples(chart.notes, result.sections);
  const durationMs =
    chart.notes.length > 1
      ? chart.notes[chart.notes.length - 1]!.startMs - chart.notes[0]!.startMs
      : 0;
  const averageNps =
    durationMs > 0 ? chart.notes.length / Math.max(1, durationMs / 1000) : 0;
  const peakNps = samples.reduce(
    (maxNps, sample) => Math.max(maxNps, sample.notesPerSecond),
    0,
  );
  const peakChordSize = samples.reduce(
    (maxSize, sample) => Math.max(maxSize, sample.peakChordSize),
    0,
  );

  return {
    algorithm: PATTERN_ALGORITHM,
    columnCount: result.columnCount,
    noteCount: chart.notes.length,
    holdCount,
    durationMs,
    averageNps,
    peakNps,
    peakChordSize,
    dominantPattern: result.dominantPattern,
    secondaryPattern: result.secondaryPattern,
    confidence: result.confidence,
    composition: normalizeBreakdown(result.composition),
    samples,
    hotspots: buildHotspots(samples),
    error: null,
  };
}

function toIso(d: Date | null | undefined): string {
  return toIsoNullable(d) ?? new Date().toISOString();
}

function rowToResult(
  row: typeof beatmapPatternAnalysis.$inferSelect,
  cached: boolean,
): PatternAnalysisRating {
  return {
    algorithm: PATTERN_ALGORITHM,
    beatmapHash: row.beatmapHash,
    columnCount: row.columnCount,
    dominantPattern: (row.dominantPattern as PatternLabel | null) ?? null,
    secondaryPattern: (row.secondaryPattern as PatternLabel | null) ?? null,
    confidence: row.confidence,
    jackDensity: row.jackDensity,
    chordDensity: row.chordDensity,
    streamDensity: row.streamDensity,
    bracketDensity: row.bracketDensity,
    chordjackScore: row.chordjackScore,
    jumpstreamScore: row.jumpstreamScore,
    chordstreamScore: row.chordstreamScore,
    error: row.error,
    updatedAt: toIso(row.updatedAt),
    cached,
  };
}

async function upsertRating(
  db: Db,
  values: typeof beatmapPatternAnalysis.$inferInsert,
): Promise<PatternAnalysisRating> {
  await db
    .insert(beatmapPatternAnalysis)
    .values(values)
    .onConflictDoUpdate({
      target: [
        beatmapPatternAnalysis.beatmapId,
        beatmapPatternAnalysis.algorithm,
      ],
      set: {
        beatmapHash: values.beatmapHash,
        columnCount: values.columnCount,
        dominantPattern: values.dominantPattern,
        secondaryPattern: values.secondaryPattern,
        confidence: values.confidence,
        jackDensity: values.jackDensity,
        chordDensity: values.chordDensity,
        streamDensity: values.streamDensity,
        bracketDensity: values.bracketDensity,
        chordjackScore: values.chordjackScore,
        jumpstreamScore: values.jumpstreamScore,
        chordstreamScore: values.chordstreamScore,
        error: values.error,
        updatedAt: values.updatedAt,
      },
    });

  return rowToResult(
    {
      beatmapId: values.beatmapId,
      algorithm: values.algorithm,
      beatmapHash: values.beatmapHash ?? null,
      columnCount: values.columnCount ?? null,
      dominantPattern: values.dominantPattern ?? null,
      secondaryPattern: values.secondaryPattern ?? null,
      confidence: values.confidence ?? null,
      jackDensity: values.jackDensity ?? null,
      chordDensity: values.chordDensity ?? null,
      streamDensity: values.streamDensity ?? null,
      bracketDensity: values.bracketDensity ?? null,
      chordjackScore: values.chordjackScore ?? null,
      jumpstreamScore: values.jumpstreamScore ?? null,
      chordstreamScore: values.chordstreamScore ?? null,
      error: values.error ?? null,
      updatedAt: values.updatedAt,
    },
    false,
  );
}

export async function getOrComputePatternAnalysis(
  db: Db,
  beatmapId: string,
  options: { force?: boolean } = {},
): Promise<PatternAnalysisRating | null> {
  const [beatmap] = await db
    .select({
      id: beatmaps.id,
      hash: beatmaps.hash,
      rulesetShortName: beatmaps.rulesetShortName,
      circleSize: beatmaps.circleSize,
    })
    .from(beatmaps)
    .where(eq(beatmaps.id, beatmapId))
    .limit(1);

  if (!beatmap) return null;

  if (!options.force) {
    const [cached] = await db
      .select()
      .from(beatmapPatternAnalysis)
      .where(
        and(
          eq(beatmapPatternAnalysis.beatmapId, beatmapId),
          eq(beatmapPatternAnalysis.algorithm, PATTERN_ALGORITHM),
        ),
      )
      .limit(1);

    if (
      cached &&
      cached.beatmapHash === beatmap.hash &&
      cached.error == null &&
      cached.dominantPattern != null
    ) {
      return rowToResult(cached, true);
    }
  }

  return computeOnePattern(db, beatmap);
}

export async function getManiaPatternDetail(
  db: Db,
  beatmapId: string,
): Promise<ManiaPatternDetail | null> {
  const [beatmap] = await db
    .select({
      id: beatmaps.id,
      hash: beatmaps.hash,
      rulesetShortName: beatmaps.rulesetShortName,
      circleSize: beatmaps.circleSize,
    })
    .from(beatmaps)
    .where(eq(beatmaps.id, beatmapId))
    .limit(1);

  if (!beatmap) return null;
  if (beatmap.rulesetShortName !== "mania") return null;
  if (!beatmap.hash) {
    return emptyManiaPatternDetail("Beatmap hash missing.");
  }

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
  if (!filePath) {
    return emptyManiaPatternDetail("Could not resolve lazer file path.");
  }

  let osuText: string;
  try {
    osuText = readFileSync(filePath, "utf8");
  } catch {
    return emptyManiaPatternDetail("Beatmap file not found in lazer files store.");
  }

  try {
    return analyzeManiaPatternDetail(osuText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return emptyManiaPatternDetail(message);
  }
}

/** @deprecated Use getManiaPatternDetail */
export const getSevenKPatternDetail = getManiaPatternDetail;

type BeatmapRow = {
  id: string;
  hash: string | null;
  rulesetShortName: string | null;
  circleSize: number | null;
};

async function computeOnePattern(
  db: Db,
  beatmap: BeatmapRow,
): Promise<PatternAnalysisRating> {
  const now = new Date();

  if (beatmap.rulesetShortName !== "mania") {
    return upsertRating(db, {
      beatmapId: beatmap.id,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: beatmap.hash,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: "Not a mania beatmap",
      updatedAt: now,
    });
  }

  if (!beatmap.hash) {
    return upsertRating(db, {
      beatmapId: beatmap.id,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: null,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: "Beatmap hash missing",
      updatedAt: now,
    });
  }

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
  if (!filePath) {
    return upsertRating(db, {
      beatmapId: beatmap.id,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: beatmap.hash,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: "Could not resolve lazer file path",
      updatedAt: now,
    });
  }

  let osuText: string;
  try {
    osuText = readFileSync(filePath, "utf8");
  } catch {
    return upsertRating(db, {
      beatmapId: beatmap.id,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: beatmap.hash,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: "Beatmap file not found in lazer files store",
      updatedAt: now,
    });
  }

  try {
    const result = analyzeManiaFromOsuText(osuText, PATTERN_ALGORITHM);
    return upsertRating(db, {
      beatmapId: beatmap.id,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: beatmap.hash,
      columnCount: result.columnCount,
      dominantPattern: result.dominantPattern,
      secondaryPattern: result.secondaryPattern,
      confidence: result.confidence,
      jackDensity: result.jackDensity,
      chordDensity: result.chordDensity,
      streamDensity: result.streamDensity,
      bracketDensity: result.bracketDensity,
      chordjackScore: result.chordjackScore,
      jumpstreamScore: result.jumpstreamScore,
      chordstreamScore: result.chordstreamScore,
      error: null,
      updatedAt: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return upsertRating(db, {
      beatmapId: beatmap.id,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: beatmap.hash,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: message,
      updatedAt: now,
    });
  }
}

function upsertRatingSync(
  db: Db,
  values: {
    beatmapId: string;
    beatmapHash: string | null;
    columnCount: number | null;
    dominantPattern: string | null;
    secondaryPattern: string | null;
    confidence: number | null;
    jackDensity: number | null;
    chordDensity: number | null;
    streamDensity: number | null;
    bracketDensity: number | null;
    chordjackScore: number | null;
    jumpstreamScore: number | null;
    chordstreamScore: number | null;
    error: string | null;
    updatedAtMs: number;
  },
): void {
  db.$client
    .query(
      `
      INSERT INTO beatmap_pattern_analysis (
        beatmap_id, algorithm, beatmap_hash, column_count,
        dominant_pattern, secondary_pattern, confidence,
        jack_density, chord_density, stream_density, bracket_density,
        chordjack_score, jumpstream_score, chordstream_score,
        error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(beatmap_id, algorithm) DO UPDATE SET
        beatmap_hash = excluded.beatmap_hash,
        column_count = excluded.column_count,
        dominant_pattern = excluded.dominant_pattern,
        secondary_pattern = excluded.secondary_pattern,
        confidence = excluded.confidence,
        jack_density = excluded.jack_density,
        chord_density = excluded.chord_density,
        stream_density = excluded.stream_density,
        bracket_density = excluded.bracket_density,
        chordjack_score = excluded.chordjack_score,
        jumpstream_score = excluded.jumpstream_score,
        chordstream_score = excluded.chordstream_score,
        error = excluded.error,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      values.beatmapId,
      PATTERN_ALGORITHM,
      values.beatmapHash,
      values.columnCount,
      values.dominantPattern,
      values.secondaryPattern,
      values.confidence,
      values.jackDensity,
      values.chordDensity,
      values.streamDensity,
      values.bracketDensity,
      values.chordjackScore,
      values.jumpstreamScore,
      values.chordstreamScore,
      values.error,
      values.updatedAtMs,
    );
}

function computeOnePatternSync(
  db: Db,
  beatmapId: string,
  hash: string | null,
  rulesetShortName: string | null,
  circleSize: number | null,
): void {
  const now = Date.now();

  if (rulesetShortName !== "mania") {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: "Not a mania beatmap",
      updatedAtMs: now,
    });
    return;
  }

  if (!hash) {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: null,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: "Beatmap hash missing",
      updatedAtMs: now,
    });
    return;
  }

  const filePath = resolveLazerFilePath(hash, getOsuDataPath());
  if (!filePath) {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: "Could not resolve lazer file path",
      updatedAtMs: now,
    });
    return;
  }

  let osuText: string;
  try {
    osuText = readFileSync(filePath, "utf8");
  } catch {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: "Beatmap file not found in lazer files store",
      updatedAtMs: now,
    });
    return;
  }

  try {
    const result = analyzeManiaFromOsuText(osuText, PATTERN_ALGORITHM);
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      columnCount: result.columnCount,
      dominantPattern: result.dominantPattern,
      secondaryPattern: result.secondaryPattern,
      confidence: result.confidence,
      jackDensity: result.jackDensity,
      chordDensity: result.chordDensity,
      streamDensity: result.streamDensity,
      bracketDensity: result.bracketDensity,
      chordjackScore: result.chordjackScore,
      jumpstreamScore: result.jumpstreamScore,
      chordstreamScore: result.chordstreamScore,
      error: null,
      updatedAtMs: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      columnCount: null,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      jackDensity: null,
      chordDensity: null,
      streamDensity: null,
      bracketDensity: null,
      chordjackScore: null,
      jumpstreamScore: null,
      chordstreamScore: null,
      error: message,
      updatedAtMs: now,
    });
  }
}

/** Max maps to compute per pattern query so first filter stays responsive. */
const PATTERN_QUERY_BACKFILL_LIMIT = 120;

export function backfillPatternAnalysisSync(
  db: Db,
  opts: {
    limit?: number;
    includeFailed?: boolean;
  } = {},
): {
  attempted: number;
  succeeded: number;
  remaining: number;
} {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 80));
  const includeFailed = opts.includeFailed === true;

  const missingClause = includeFailed
    ? `
        (
          pa.beatmap_id IS NULL
          OR pa.dominant_pattern IS NULL
          OR (
            b.hash IS NOT NULL
            AND pa.beatmap_hash IS NOT NULL
            AND pa.beatmap_hash != b.hash
          )
        )
      `
    : `
        (
          pa.beatmap_id IS NULL
          OR (
            b.hash IS NOT NULL
            AND pa.beatmap_hash IS NOT NULL
            AND pa.beatmap_hash != b.hash
          )
        )
      `;

  const missing = db.$client
    .query(
      `
      SELECT b.id AS id, b.hash AS hash,
             b.ruleset_short_name AS ruleset_short_name,
             b.circle_size AS circle_size
      FROM beatmaps b
      LEFT JOIN beatmap_pattern_analysis pa
        ON pa.beatmap_id = b.id AND pa.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND ${missingClause}
      ORDER BY
        CASE
          WHEN pa.beatmap_id IS NULL THEN 0
          WHEN b.hash IS NOT NULL
            AND pa.beatmap_hash IS NOT NULL
            AND pa.beatmap_hash != b.hash THEN 1
          ELSE 2
        END,
        b.id
      LIMIT ?
    `,
    )
    .all(PATTERN_ALGORITHM, limit) as Array<{
    id: string;
    hash: string | null;
    ruleset_short_name: string | null;
    circle_size: number | null;
  }>;

  let succeeded = 0;
  for (const row of missing) {
    computeOnePatternSync(
      db,
      row.id,
      row.hash,
      row.ruleset_short_name,
      row.circle_size,
    );
    const updated = db.$client
      .query(
        `
        SELECT dominant_pattern AS dominantPattern
        FROM beatmap_pattern_analysis
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .get(row.id, PATTERN_ALGORITHM) as { dominantPattern: string | null } | null;
    if (updated?.dominantPattern) succeeded += 1;
  }

  const remainingRow = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_pattern_analysis pa
        ON pa.beatmap_id = b.id AND pa.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND ${missingClause}
    `,
    )
    .get(PATTERN_ALGORITHM) as { n: number } | null;

  return {
    attempted: missing.length,
    succeeded,
    remaining: Number(remainingRow?.n ?? 0),
  };
}

export function ensurePatternAnalysisForIdsSync(
  db: Db,
  ids: string[],
): Map<string, PatternLabel> {
  const out = new Map<string, PatternLabel>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;

  const placeholders = unique.map(() => "?").join(",");
  const rows = db.$client
    .query(
      `
      SELECT b.id AS id, b.hash AS hash,
             b.ruleset_short_name AS rulesetShortName,
             b.circle_size AS circleSize,
             pa.dominant_pattern AS dominantPattern
      FROM beatmaps b
      LEFT JOIN beatmap_pattern_analysis pa
        ON pa.beatmap_id = b.id AND pa.algorithm = ?
      WHERE b.id IN (${placeholders})
    `,
    )
    .all(PATTERN_ALGORITHM, ...unique) as Array<{
    id: string;
    hash: string | null;
    rulesetShortName: string | null;
    circleSize: number | null;
    dominantPattern: string | null;
  }>;

  for (const row of rows) {
    if (row.dominantPattern) {
      out.set(row.id, row.dominantPattern as PatternLabel);
      continue;
    }
    if (row.rulesetShortName !== "mania") continue;

    computeOnePatternSync(
      db,
      row.id,
      row.hash,
      row.rulesetShortName,
      row.circleSize,
    );
    const updated = db.$client
      .query(
        `
        SELECT dominant_pattern AS dominantPattern
        FROM beatmap_pattern_analysis
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .get(row.id, PATTERN_ALGORITHM) as { dominantPattern: string | null } | null;
    if (updated?.dominantPattern) {
      out.set(row.id, updated.dominantPattern as PatternLabel);
    }
  }

  return out;
}

export { PATTERN_QUERY_BACKFILL_LIMIT };
