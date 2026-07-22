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
import { getVersion } from "./registry";
import { readExecutablePath } from "./settings";
import { toIso as toIsoNullable } from "../shared/serialize";

export type ManiaRatingAttributes = Record<string, unknown>;

export type ManiaRatingResult = {
  versionId: string;
  beatmapHash: string | null;
  starRating: number | null;
  starRatingSs: number | null;
  ppSs: number | null;
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

function isValidCached(
  cached: typeof beatmapManiaRatings.$inferSelect,
  beatmapHash: string | null,
): boolean {
  return (
    cached.error == null &&
    cached.starRating != null &&
    cached.ppSs != null &&
    cached.beatmapHash === beatmapHash
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
    })
    .from(beatmaps)
    .where(eq(beatmaps.id, beatmapId))
    .limit(1);

  if (!beatmap) return null;

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

    if (cached && isValidCached(cached, beatmap.hash)) {
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
      attributesJson: null,
      error: "Not a mania beatmap",
      updatedAt: now,
    });
  }

  const executablePath = await readExecutablePath(db, versionId);
  if (!executablePath) {
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
      attributesJson: null,
      error: `Executable not configured for version ${versionId}`,
      updatedAt: now,
    });
  }

  if (!beatmap.hash) {
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: null,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
      attributesJson: null,
      error: "Beatmap hash missing",
      updatedAt: now,
    });
  }

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
  if (!filePath) {
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
      attributesJson: null,
      error: "Could not resolve lazer file path",
      updatedAt: now,
    });
  }

  try {
    readFileSync(filePath, "utf8");
  } catch {
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
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
      starRating: output.starRating ?? null,
      starRatingSs: output.starRatingSs ?? null,
      ppSs: output.ppSs ?? null,
      attributesJson: output.attributes
        ? JSON.stringify(output.attributes)
        : null,
      error: null,
      updatedAt: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return upsertRating(db, {
      beatmapId,
      versionId,
      beatmapHash: beatmap.hash,
      starRating: null,
      starRatingSs: null,
      ppSs: null,
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

type MissingRow = {
  id: string;
  hash: string | null;
  ruleset_short_name: string | null;
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
        pp_ss, attributes_json, error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(beatmap_id, version_id) DO UPDATE SET
        beatmap_hash = excluded.beatmap_hash,
        star_rating = excluded.star_rating,
        star_rating_ss = excluded.star_rating_ss,
        pp_ss = excluded.pp_ss,
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
      values.attributesJson,
      values.error,
      values.updatedAtMs,
    );
}

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
        SELECT b.id, b.hash, b.ruleset_short_name
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
      SELECT b.id, b.hash, b.ruleset_short_name
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
            AND (mr.star_rating IS NULL OR mr.pp_ss IS NULL)
          )
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
        )
    `,
    )
    .get(versionId) as { n: number } | null;
  return Number(row?.n ?? 0);
}

/** Synchronous backfill for job worker and query-time ensure. */
export function backfillManiaRatingsSync(
  db: Db,
  versionId: string,
  options: {
    limit?: number;
    beatmapIds?: string[];
    includeFailed?: boolean;
  } = {},
): BackfillManiaRatingResult {
  const limit = options.limit ?? 20;
  const executablePath = db.$client
    .query(`SELECT value FROM settings WHERE key = ? LIMIT 1`)
    .get(`maniaRating.executable.${versionId}`) as { value: string } | null;

  if (!executablePath?.value?.trim()) {
    return { attempted: 0, succeeded: 0, remaining: countRemainingMissing(db, versionId) };
  }

  const exe = executablePath.value.trim();
  const rows = fetchMissingRows(db, versionId, limit, options.beatmapIds);
  let succeeded = 0;

  for (const row of rows) {
    const nowMs = Date.now();

    if ((row.ruleset_short_name ?? "").toLowerCase() !== "mania") {
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: null,
        starRatingSs: null,
        ppSs: null,
        attributesJson: null,
        error: "Not a mania beatmap",
        updatedAtMs: nowMs,
      });
      continue;
    }

    if (!row.hash) {
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: null,
        starRating: null,
        starRatingSs: null,
        ppSs: null,
        attributesJson: null,
        error: "Beatmap hash missing",
        updatedAtMs: nowMs,
      });
      continue;
    }

    const filePath = resolveLazerFilePath(row.hash, getOsuDataPath());
    if (!filePath) {
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: null,
        starRatingSs: null,
        ppSs: null,
        attributesJson: null,
        error: "Could not resolve lazer file path",
        updatedAtMs: nowMs,
      });
      continue;
    }

    try {
      readFileSync(filePath, "utf8");
    } catch {
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: null,
        starRatingSs: null,
        ppSs: null,
        attributesJson: null,
        error: "Beatmap file not found in lazer files store",
        updatedAtMs: nowMs,
      });
      continue;
    }

    try {
      const proc = Bun.spawnSync({
        cmd: [exe, "--mods", "NM", "--version-id", versionId, filePath],
        stdout: "pipe",
        stderr: "pipe",
      });

      if (proc.exitCode !== 0) {
        const stderr = proc.stderr.toString().trim();
        let message = stderr || `Calculator exited with code ${proc.exitCode}`;
        try {
          const errJson = JSON.parse(stderr) as { error?: string };
          if (errJson.error) message = errJson.error;
        } catch {
          // keep message
        }
        throw new Error(message);
      }

      const output = parseCliOutput(proc.stdout.toString());
      if (output.error) throw new Error(output.error);

      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: output.starRating ?? null,
        starRatingSs: output.starRatingSs ?? null,
        ppSs: output.ppSs ?? null,
        attributesJson: output.attributes
          ? JSON.stringify(output.attributes)
          : null,
        error: null,
        updatedAtMs: nowMs,
      });
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      upsertRatingSync(db, {
        beatmapId: row.id,
        versionId,
        beatmapHash: row.hash,
        starRating: null,
        starRatingSs: null,
        ppSs: null,
        attributesJson: null,
        error: message,
        updatedAtMs: nowMs,
      });
    }
  }

  return {
    attempted: rows.length,
    succeeded,
    remaining: countRemainingMissing(db, versionId),
  };
}

export function ensureManiaRatingsForIdsSync(
  db: Db,
  versionId: string,
  beatmapIds: string[],
  limit = 40,
): void {
  if (beatmapIds.length === 0) return;
  backfillManiaRatingsSync(db, versionId, { limit, beatmapIds });
}

export const RATING_QUERY_BACKFILL_LIMIT = 40;
