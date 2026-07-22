import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import {
  beatmapManiaRatings,
  beatmaps,
  type Db,
} from "@roxysu/db/client.bun";
import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import { getVersion, usesImportedRating } from "./registry";
import { readExecutablePath } from "./settings";
import { toIso as toIsoNullable } from "../shared/serialize";
import {
  hasCompletePpByAccuracy,
  parsePpByAccuracy,
  type PpByAccuracy,
} from "./ppAccuracy";

export type ManiaRatingAttributes = Record<string, unknown>;

export type ManiaRatingResult = {
  versionId: string;
  beatmapHash: string | null;
  starRating: number | null;
  starRatingSs: number | null;
  ppSs: number | null;
  ppByAccuracy: PpByAccuracy | null;
  attributes: ManiaRatingAttributes | null;
  error: string | null;
  updatedAt: string;
  cached: boolean;
};

type CliOutput = {
  version?: string;
  starRating?: number;
  starRatingSs?: number | null;
  ppSs?: number;
  ppByAccuracy?: PpByAccuracy | null;
  attributes?: ManiaRatingAttributes | null;
  error?: string;
};

function toIso(d: Date | null | undefined): string {
  return toIsoNullable(d) ?? new Date().toISOString();
}

function rowToResult(
  row: typeof beatmapManiaRatings.$inferSelect,
  cached: boolean,
): ManiaRatingResult {
  let attributes: ManiaRatingAttributes | null = null;
  if (row.attributesJson) {
    try {
      attributes = JSON.parse(row.attributesJson) as ManiaRatingAttributes;
    } catch {
      attributes = null;
    }
  }

  return {
    versionId: row.versionId,
    beatmapHash: row.beatmapHash,
    starRating: row.starRating,
    starRatingSs: row.starRatingSs,
    ppSs: row.ppSs,
    ppByAccuracy: parsePpByAccuracy(row.ppByAccuracyJson),
    attributes,
    error: row.error,
    updatedAt: toIso(row.updatedAt),
    cached,
  };
}

async function upsertRating(
  db: Db,
  values: typeof beatmapManiaRatings.$inferInsert,
): Promise<ManiaRatingResult> {
  await db
    .insert(beatmapManiaRatings)
    .values(values)
    .onConflictDoUpdate({
      target: [beatmapManiaRatings.beatmapId, beatmapManiaRatings.versionId],
      set: {
        beatmapHash: values.beatmapHash,
        starRating: values.starRating,
        starRatingSs: values.starRatingSs,
        ppSs: values.ppSs,
        ppByAccuracyJson: values.ppByAccuracyJson,
        attributesJson: values.attributesJson,
        error: values.error,
        updatedAt: values.updatedAt,
      },
    });

  return rowToResult(
    {
      beatmapId: values.beatmapId,
      versionId: values.versionId,
      beatmapHash: values.beatmapHash ?? null,
      starRating: values.starRating ?? null,
      starRatingSs: values.starRatingSs ?? null,
      ppSs: values.ppSs ?? null,
      ppByAccuracyJson: values.ppByAccuracyJson ?? null,
      attributesJson: values.attributesJson ?? null,
      error: values.error ?? null,
      updatedAt: values.updatedAt,
    },
    false,
  );
}

function parseCliOutput(stdout: string): CliOutput {
  const trimmed = stdout.trim();
  const line =
    trimmed
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("{")) ?? trimmed;
  return JSON.parse(line) as CliOutput;
}

async function runCalculator(
  executablePath: string,
  beatmapPath: string,
  versionId: string,
): Promise<CliOutput> {
  const proc = Bun.spawn({
    cmd: [executablePath, "--mods", "NM", "--version-id", versionId, beatmapPath],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    try {
      const errJson = JSON.parse(stderr.trim()) as { error?: string };
      if (errJson.error) throw new Error(errJson.error);
    } catch (parseErr) {
      if (parseErr instanceof Error && parseErr.message !== stderr.trim()) {
        throw parseErr;
      }
    }
    throw new Error(stderr.trim() || `Calculator exited with code ${exitCode}`);
  }

  return parseCliOutput(stdout);
}

function hasExecutableConfigured(db: Db, versionId: string): boolean {
  const row = db.$client
    .query(`SELECT value FROM settings WHERE key = ? LIMIT 1`)
    .get(`maniaRating.executable.${versionId}`) as { value: string } | null;
  return Boolean(row?.value?.trim());
}

function serializePpByAccuracy(
  map: PpByAccuracy | null | undefined,
): string | null {
  if (!map || !hasCompletePpByAccuracy(map)) return null;
  return JSON.stringify(map);
}

function isValidCached(
  cached: typeof beatmapManiaRatings.$inferSelect,
  beatmapHash: string | null,
  versionId: string,
  options: { requirePp?: boolean } = {},
): boolean {
  if (cached.error != null) return false;
  if (cached.beatmapHash !== beatmapHash) return false;

  const ppByAccuracy = parsePpByAccuracy(cached.ppByAccuracyJson);

  if (usesImportedRating(versionId)) {
    if (cached.starRating == null) return false;
    // When a binary is configured, SR-only rows are stale — need SS PP + accuracy tiers.
    if (options.requirePp) {
      if (cached.ppSs == null) return false;
      if (!hasCompletePpByAccuracy(ppByAccuracy)) return false;
    }
    return true;
  }

  return (
    cached.starRating != null &&
    cached.ppSs != null &&
    hasCompletePpByAccuracy(ppByAccuracy)
  );
}

/**
 * Return cached mania rating or compute from local lazer `.osu` via calculator CLI.
 */
export async function getOrComputeManiaRating(
  db: Db,
  beatmapId: string,
  versionId: string,
  options: { force?: boolean } = {},
): Promise<ManiaRatingResult | null> {
  if (!getVersion(versionId)) {
    throw new Error(`Unknown mania rating version: ${versionId}`);
  }

  const [beatmap] = await db
    .select({
      id: beatmaps.id,
      hash: beatmaps.hash,
      rulesetShortName: beatmaps.rulesetShortName,
      starRating: beatmaps.starRating,
    })
    .from(beatmaps)
    .where(eq(beatmaps.id, beatmapId))
    .limit(1);

  if (!beatmap) return null;

  const importBaseline = usesImportedRating(versionId);
  const requirePp = hasExecutableConfigured(db, versionId);

  if (!options.force) {
    const [cached] = await db
      .select()
      .from(beatmapManiaRatings)
      .where(
        and(
          eq(beatmapManiaRatings.beatmapId, beatmapId),
          eq(beatmapManiaRatings.versionId, versionId),
        ),
      )
      .limit(1);

    if (
      cached &&
      isValidCached(cached, beatmap.hash, versionId, { requirePp }) &&
      (!importBaseline || cached.starRating === beatmap.starRating)
    ) {
      return rowToResult(cached, true);
    }
  }

  const now = new Date();

  if ((beatmap.rulesetShortName ?? "").toLowerCase() !== "mania") {
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
      ppByAccuracyJson: null,
      attributesJson: null,
      error: "Not a mania beatmap",
      updatedAt: now,
    });
  }

  const executablePath = await readExecutablePath(db, versionId);

  if (!executablePath) {
    if (importBaseline) {
      return upsertRating(db, {
        beatmapId,
        versionId,
        beatmapHash: beatmap.hash,
        starRating: beatmap.starRating,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        error: null,
        updatedAt: now,
      });
    }
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
      ppByAccuracyJson: null,
      attributesJson: null,
      error: `Executable not configured for version ${versionId}`,
      updatedAt: now,
    });
  }

  if (!beatmap.hash) {
    if (importBaseline) {
      return upsertRating(db, {
        beatmapId,
        versionId,
        beatmapHash: null,
        starRating: beatmap.starRating,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        error: null,
        updatedAt: now,
      });
    }
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: null,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
      ppByAccuracyJson: null,
      attributesJson: null,
      error: "Beatmap hash missing",
      updatedAt: now,
    });
  }

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
  if (!filePath) {
    if (importBaseline) {
      return upsertRating(db, {
        beatmapId,
        versionId,
        beatmapHash: beatmap.hash,
        starRating: beatmap.starRating,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        error: null,
        updatedAt: now,
      });
    }
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
      ppByAccuracyJson: null,
      attributesJson: null,
      error: "Could not resolve lazer file path",
      updatedAt: now,
    });
  }

  try {
    readFileSync(filePath, "utf8");
  } catch {
    if (importBaseline) {
      return upsertRating(db, {
        beatmapId,
        versionId,
        beatmapHash: beatmap.hash,
        starRating: beatmap.starRating,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        error: null,
        updatedAt: now,
      });
    }
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
      ppByAccuracyJson: null,
      attributesJson: null,
      error: "Beatmap file not found in lazer files store",
      updatedAt: now,
    });
  }

  try {
    const output = await runCalculator(executablePath, filePath, versionId);
    if (output.error) {
      throw new Error(output.error);
    }

    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: importBaseline
        ? beatmap.starRating
        : (output.starRating ?? null),
      starRatingSs: output.starRatingSs ?? null,
      ppSs: output.ppSs ?? null,
      ppByAccuracyJson: serializePpByAccuracy(output.ppByAccuracy),
      attributesJson: output.attributes
        ? JSON.stringify(output.attributes)
        : null,
      error: null,
      updatedAt: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (importBaseline) {
      return upsertRating(db, {
        beatmapId,
        versionId,
        beatmapHash: beatmap.hash,
        starRating: beatmap.starRating,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        error: message,
        updatedAt: now,
      });
    }
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
      ppByAccuracyJson: null,
      attributesJson: null,
      error: message,
      updatedAt: now,
    });
  }
}

export type BackfillManiaRatingResult = {
  attempted: number;
  succeeded: number;
  remaining: number;
};

/** How many calculator processes to run at once. Override with MANIA_RATING_CONCURRENCY. */
export const CALCULATOR_CONCURRENCY = Math.max(
  1,
  Number(process.env.MANIA_RATING_CONCURRENCY) || 4,
);

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }

  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

type MissingRow = {
  id: string;
  hash: string | null;
  ruleset_short_name: string | null;
  star_rating: number | null;
};

function upsertRatingSync(
  db: Db,
  values: {
    beatmapId: string;
    versionId: string;
    beatmapHash: string | null;
    starRating: number | null;
    starRatingSs: number | null;
    ppSs: number | null;
    ppByAccuracyJson: string | null;
    attributesJson: string | null;
    error: string | null;
    updatedAtMs: number;
  },
): void {
  db.$client
    .query(
      `
      INSERT INTO beatmap_mania_ratings (
        beatmap_id, version_id, beatmap_hash, star_rating, star_rating_ss,
        pp_ss, pp_by_accuracy_json, attributes_json, error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(beatmap_id, version_id) DO UPDATE SET
        beatmap_hash = excluded.beatmap_hash,
        star_rating = excluded.star_rating,
        star_rating_ss = excluded.star_rating_ss,
        pp_ss = excluded.pp_ss,
        pp_by_accuracy_json = excluded.pp_by_accuracy_json,
        attributes_json = excluded.attributes_json,
        error = excluded.error,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      values.beatmapId,
      values.versionId,
      values.beatmapHash,
      values.starRating,
      values.starRatingSs,
      values.ppSs,
      values.ppByAccuracyJson,
      values.attributesJson,
      values.error,
      values.updatedAtMs,
    );
}

function fetchRowsByIds(
  db: Db,
  beatmapIds: string[],
  limit: number,
): MissingRow[] {
  if (beatmapIds.length === 0) return [];
  const placeholders = beatmapIds.map(() => "?").join(", ");
  return db.$client
    .query(
      `
      SELECT b.id, b.hash, b.ruleset_short_name, b.star_rating
      FROM beatmaps b
      WHERE b.id IN (${placeholders})
        AND b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
      LIMIT ?
    `,
    )
    .all(...beatmapIds, limit) as MissingRow[];
}

const MISSING_PP_ACCURACY_SQL = `(
  mr.pp_by_accuracy_json IS NULL
  OR json_extract(mr.pp_by_accuracy_json, '$.93') IS NULL
)`;

function fetchMissingRows(
  db: Db,
  versionId: string,
  limit: number,
  beatmapIds?: string[],
): MissingRow[] {
  if (beatmapIds && beatmapIds.length > 0) {
    const placeholders = beatmapIds.map(() => "?").join(", ");
    return db.$client
      .query(
        `
        SELECT b.id, b.hash, b.ruleset_short_name, b.star_rating
        FROM beatmaps b
        LEFT JOIN beatmap_mania_ratings mr
          ON mr.beatmap_id = b.id AND mr.version_id = ?
        WHERE b.id IN (${placeholders})
          AND b.hidden = 0
          AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
          AND (
            mr.beatmap_id IS NULL
            OR mr.error IS NOT NULL
            OR mr.star_rating IS NULL
            OR mr.pp_ss IS NULL
            OR ${MISSING_PP_ACCURACY_SQL}
            OR (
              b.hash IS NOT NULL
              AND mr.beatmap_hash IS NOT NULL
              AND mr.beatmap_hash != b.hash
            )
          )
        LIMIT ?
      `,
      )
      .all(versionId, ...beatmapIds, limit) as MissingRow[];
  }

  return db.$client
    .query(
      `
      SELECT b.id, b.hash, b.ruleset_short_name, b.star_rating
      FROM beatmaps b
      LEFT JOIN beatmap_mania_ratings mr
        ON mr.beatmap_id = b.id AND mr.version_id = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND (
          mr.beatmap_id IS NULL
          OR (
            b.hash IS NOT NULL
            AND mr.beatmap_hash IS NOT NULL
            AND mr.beatmap_hash != b.hash
          )
          OR (
            mr.error IS NULL
            AND (
              mr.star_rating IS NULL
              OR mr.pp_ss IS NULL
              OR ${MISSING_PP_ACCURACY_SQL}
            )
          )
          OR mr.error IS NOT NULL
        )
      LIMIT ?
    `,
    )
    .all(versionId, limit) as MissingRow[];
}

function countRemainingMissing(db: Db, versionId: string): number {
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_mania_ratings mr
        ON mr.beatmap_id = b.id AND mr.version_id = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND (
          mr.beatmap_id IS NULL
          OR (
            b.hash IS NOT NULL
            AND mr.beatmap_hash IS NOT NULL
            AND mr.beatmap_hash != b.hash
          )
          OR mr.error IS NOT NULL
          OR mr.star_rating IS NULL
          OR mr.pp_ss IS NULL
          OR ${MISSING_PP_ACCURACY_SQL}
        )
    `,
    )
    .get(versionId) as { n: number } | null;
  return Number(row?.n ?? 0);
}

/** Backfill missing mania ratings. Runs up to CALCULATOR_CONCURRENCY processes at once. */
export async function backfillManiaRatings(
  db: Db,
  versionId: string,
  options: {
    limit?: number;
    beatmapIds?: string[];
    includeFailed?: boolean;
    /** Recompute even when a complete cache row already exists. */
    force?: boolean;
    concurrency?: number;
  } = {},
): Promise<BackfillManiaRatingResult> {
  const importBaseline = usesImportedRating(versionId);
  const limit = options.limit ?? 20;
  const concurrency = options.concurrency ?? CALCULATOR_CONCURRENCY;
  const executablePath = db.$client
    .query(`SELECT value FROM settings WHERE key = ? LIMIT 1`)
    .get(`maniaRating.executable.${versionId}`) as { value: string } | null;

  // Import without a binary: nothing to compute (SR comes from Realm).
  if (!executablePath?.value?.trim()) {
    return {
      attempted: 0,
      succeeded: 0,
      remaining: importBaseline
        ? 0
        : countRemainingMissing(db, versionId),
    };
  }

  const exe = executablePath.value.trim();
  const rows =
    options.force && options.beatmapIds && options.beatmapIds.length > 0
      ? fetchRowsByIds(db, options.beatmapIds, limit)
      : fetchMissingRows(db, versionId, limit, options.beatmapIds);

  const outcomes = await mapPool(rows, concurrency, async (row) => {
    const nowMs = Date.now();

    if ((row.ruleset_short_name ?? "").toLowerCase() !== "mania") {
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: null,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        error: "Not a mania beatmap",
        updatedAtMs: nowMs,
      });
      return false;
    }

    if (!row.hash) {
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: null,
        starRating: importBaseline ? row.star_rating : null,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        error: importBaseline ? null : "Beatmap hash missing",
        updatedAtMs: nowMs,
      });
      return false;
    }

    const filePath = resolveLazerFilePath(row.hash, getOsuDataPath());
    if (!filePath) {
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: importBaseline ? row.star_rating : null,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        error: importBaseline ? null : "Could not resolve lazer file path",
        updatedAtMs: nowMs,
      });
      return false;
    }

    try {
      readFileSync(filePath, "utf8");
    } catch {
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: importBaseline ? row.star_rating : null,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        error: importBaseline
          ? null
          : "Beatmap file not found in lazer files store",
        updatedAtMs: nowMs,
      });
      return false;
    }

    try {
      const output = await runCalculator(exe, filePath, versionId);
      if (output.error) throw new Error(output.error);

      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: importBaseline
          ? row.star_rating
          : (output.starRating ?? null),
        starRatingSs: output.starRatingSs ?? null,
        ppSs: output.ppSs ?? null,
        ppByAccuracyJson: serializePpByAccuracy(output.ppByAccuracy),
        attributesJson: output.attributes
          ? JSON.stringify(output.attributes)
          : null,
        error: null,
        updatedAtMs: nowMs,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: importBaseline ? row.star_rating : null,
        starRatingSs: null,
        ppSs: null,
        ppByAccuracyJson: null,
        attributesJson: null,
        // Keep SR for import, but record PP failure so we can retry.
        error: message,
        updatedAtMs: nowMs,
      });
      return false;
    }
  });

  const succeeded = outcomes.filter(Boolean).length;

  return {
    attempted: rows.length,
    succeeded,
    remaining: countRemainingMissing(db, versionId),
  };
}

/** Alias kept for older imports — prefer backfillManiaRatings. */
export const backfillManiaRatingsSync = backfillManiaRatings;

export async function ensureManiaRatingsForIds(
  db: Db,
  versionId: string,
  beatmapIds: string[],
  limit = 40,
): Promise<void> {
  if (beatmapIds.length === 0) return;
  await backfillManiaRatings(db, versionId, { limit, beatmapIds });
}

export const ensureManiaRatingsForIdsSync = ensureManiaRatingsForIds;

export const RATING_QUERY_BACKFILL_LIMIT = 40;
