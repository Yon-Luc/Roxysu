import { readFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";
import {
  beatmapPatternAnalysis,
  beatmaps,
  type Db,
} from "@roxysu/db/client.bun";
import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import {
  analyze7kFromOsuText,
  PATTERN_ALGORITHM,
  type PatternLabel,
} from "@roxysu/pattern-7k";

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

function toIso(d: Date | null | undefined): string {
  return (d ?? new Date()).toISOString();
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

  if (beatmap.circleSize != null && Math.round(beatmap.circleSize) !== 7) {
    return upsertRating(db, {
      beatmapId: beatmap.id,
      algorithm: PATTERN_ALGORITHM,
      beatmapHash: beatmap.hash,
      columnCount: Math.round(beatmap.circleSize),
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
      error: "Pattern analysis is 7k-only",
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
    const result = analyze7kFromOsuText(osuText, PATTERN_ALGORITHM);
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

  if (circleSize != null && Math.round(circleSize) !== 7) {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      columnCount: Math.round(circleSize),
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
      error: "Pattern analysis is 7k-only",
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
    const result = analyze7kFromOsuText(osuText, PATTERN_ALGORITHM);
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
        AND ROUND(COALESCE(b.circle_size, 0)) = 7
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
        AND ROUND(COALESCE(b.circle_size, 0)) = 7
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
    if (row.circleSize != null && Math.round(row.circleSize) !== 7) continue;

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
