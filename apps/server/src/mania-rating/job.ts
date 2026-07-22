import type { Db } from "@roxysu/db/client.bun";
import { parseQuery } from "../query-language/parse";
import { compileQuery } from "../query-language/compile";
import {
  backfillManiaRatings,
  CALCULATOR_CONCURRENCY,
} from "./compute";
import { publish } from "../shared/events";
import {
  BEATMAP_SET_JOIN,
  beatmapFilterWhere,
} from "../query-language/sqlFragments";

type SqlBinding = string | number | bigint | boolean | null;

function asBindings(params: unknown[]): SqlBinding[] {
  return params as SqlBinding[];
}

export type ManiaRatingJobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "error";

export type ManiaRatingCoverage = {
  maniaTotal: number;
  computed: number;
  missing: number;
  failed: number;
};

export type ManiaRatingJobState = {
  status: ManiaRatingJobStatus;
  versionId: string | null;
  query: string | null;
  force: boolean;
  coverage: ManiaRatingCoverage;
  computedThisRun: number;
  attemptedThisRun: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  batchSize: number;
  concurrency: number;
};

const BATCH_SIZE = 32;
const YIELD_MS = 10;

let job: {
  status: ManiaRatingJobStatus;
  versionId: string | null;
  query: string | null;
  force: boolean;
  offset: number;
  computedThisRun: number;
  attemptedThisRun: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  db: Db | null;
} = {
  status: "idle",
  versionId: null,
  query: null,
  force: false,
  offset: 0,
  computedThisRun: 0,
  attemptedThisRun: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  timer: null,
  db: null,
};

function countMissingForQuery(
  db: Db,
  versionId: string,
  filterSql: string,
  params: SqlBinding[],
): number {
  const where = beatmapFilterWhere(filterSql);
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      ${BEATMAP_SET_JOIN}
      LEFT JOIN beatmap_mania_ratings mr
        ON mr.beatmap_id = b.id AND mr.version_id = ?
      ${where}
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND (
          mr.beatmap_id IS NULL
          OR mr.error IS NOT NULL
          OR mr.star_rating IS NULL
          OR mr.pp_ss IS NULL
          OR mr.pp_by_accuracy_json IS NULL
          OR json_extract(mr.pp_by_accuracy_json, '$.93') IS NULL
          OR (
            b.hash IS NOT NULL
            AND mr.beatmap_hash IS NOT NULL
            AND mr.beatmap_hash != b.hash
          )
        )
    `,
    )
    .get(versionId, ...params) as { n: number } | null;
  return Number(row?.n ?? 0);
}

function countMapsForQuery(
  db: Db,
  filterSql: string,
  params: SqlBinding[],
): number {
  const where = beatmapFilterWhere(filterSql);
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      ${BEATMAP_SET_JOIN}
      ${where}
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
    `,
    )
    .get(...params) as { n: number } | null;
  return Number(row?.n ?? 0);
}

export function getManiaRatingCoverage(
  db: Db,
  versionId: string,
): ManiaRatingCoverage {
  const totals = db.$client
    .query(
      `
      SELECT
        COUNT(*) AS maniaTotal,
        SUM(
          CASE
            WHEN mr.star_rating IS NOT NULL
              AND mr.pp_ss IS NOT NULL
              AND mr.pp_by_accuracy_json IS NOT NULL
              AND json_extract(mr.pp_by_accuracy_json, '$.93') IS NOT NULL
              AND mr.error IS NULL
              AND (
                b.hash IS NULL
                OR mr.beatmap_hash IS NULL
                OR mr.beatmap_hash = b.hash
              )
            THEN 1 ELSE 0
          END
        ) AS computed,
        SUM(
          CASE
            WHEN mr.beatmap_id IS NOT NULL
              AND mr.error IS NOT NULL
            THEN 1 ELSE 0
          END
        ) AS failed
      FROM beatmaps b
      LEFT JOIN beatmap_mania_ratings mr
        ON mr.beatmap_id = b.id AND mr.version_id = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
    `,
    )
    .get(versionId) as {
    maniaTotal: number;
    computed: number;
    failed: number;
  } | null;

  const maniaTotal = Number(totals?.maniaTotal ?? 0);
  const computed = Number(totals?.computed ?? 0);
  const failed = Number(totals?.failed ?? 0);

  const missingRow = db.$client
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
          OR mr.error IS NOT NULL
          OR mr.star_rating IS NULL
          OR mr.pp_ss IS NULL
          OR mr.pp_by_accuracy_json IS NULL
          OR json_extract(mr.pp_by_accuracy_json, '$.93') IS NULL
          OR (
            b.hash IS NOT NULL
            AND mr.beatmap_hash IS NOT NULL
            AND mr.beatmap_hash != b.hash
          )
        )
    `,
    )
    .get(versionId) as { n: number } | null;

  return {
    maniaTotal,
    computed,
    missing: Number(missingRow?.n ?? 0),
    failed,
  };
}

export function getManiaRatingJobState(db: Db): ManiaRatingJobState {
  const versionId = job.versionId;
  return {
    status: job.status,
    versionId,
    query: job.query,
    force: job.force,
    coverage: versionId
      ? getManiaRatingCoverage(db, versionId)
      : { maniaTotal: 0, computed: 0, missing: 0, failed: 0 },
    computedThisRun: job.computedThisRun,
    attemptedThisRun: job.attemptedThisRun,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error,
    batchSize: BATCH_SIZE,
    concurrency: CALCULATOR_CONCURRENCY,
  };
}

function clearTimer(): void {
  if (job.timer != null) {
    clearTimeout(job.timer);
    job.timer = null;
  }
}

function finish(status: "completed" | "idle" | "error", error?: string): void {
  clearTimer();
  job.status = status === "idle" ? "idle" : status;
  job.finishedAt = new Date();
  job.error = error ?? null;
  job.db = null;
  publish({ type: "dashboard.updated" });
}

function scheduleNext(): void {
  clearTimer();
  job.timer = setTimeout(() => {
    job.timer = null;
    void runBatch();
  }, YIELD_MS);
}

function fetchBatchBeatmapIds(
  db: Db,
  versionId: string,
  filterSql: string,
  params: SqlBinding[],
  limit: number,
  options: { force?: boolean; offset?: number } = {},
): string[] {
  const where = beatmapFilterWhere(filterSql);
  if (options.force) {
    const rows = db.$client
      .query(
        `
        SELECT b.id
        FROM beatmaps b
        ${BEATMAP_SET_JOIN}
        ${where}
          AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        ORDER BY b.id
        LIMIT ?
        OFFSET ?
      `,
      )
      .all(...params, limit, options.offset ?? 0) as { id: string }[];
    return rows.map((r) => r.id);
  }

  const rows = db.$client
    .query(
      `
      SELECT b.id
      FROM beatmaps b
      ${BEATMAP_SET_JOIN}
      LEFT JOIN beatmap_mania_ratings mr
        ON mr.beatmap_id = b.id AND mr.version_id = ?
      ${where}
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND (
          mr.beatmap_id IS NULL
          OR mr.error IS NOT NULL
          OR mr.star_rating IS NULL
          OR mr.pp_ss IS NULL
          OR mr.pp_by_accuracy_json IS NULL
          OR json_extract(mr.pp_by_accuracy_json, '$.93') IS NULL
          OR (
            b.hash IS NOT NULL
            AND mr.beatmap_hash IS NOT NULL
            AND mr.beatmap_hash != b.hash
          )
        )
      LIMIT ?
    `,
    )
    .all(versionId, ...params, limit) as { id: string }[];

  return rows.map((r) => r.id);
}

async function runBatch(): Promise<void> {
  const db = job.db;
  const versionId = job.versionId;
  const query = job.query;

  if (!db || !versionId || !query) {
    finish("error", "Backfill job lost database handle or scope");
    return;
  }

  if (job.status === "stopping") {
    finish("idle");
    return;
  }

  if (job.status !== "running") return;

  try {
    const ast = parseQuery(query);
    const compiled = compileQuery(ast);
    const ids = fetchBatchBeatmapIds(
      db,
      versionId,
      compiled.sql,
      asBindings(compiled.params),
      BATCH_SIZE,
      { force: job.force, offset: job.offset },
    );

    if (ids.length === 0) {
      finish("completed");
      return;
    }

    const result = await backfillManiaRatings(db, versionId, {
      limit: BATCH_SIZE,
      beatmapIds: ids,
      force: job.force,
      concurrency: CALCULATOR_CONCURRENCY,
    });

    job.attemptedThisRun += result.attempted;
    job.computedThisRun += result.succeeded;

    // No calculator work possible (e.g. executable not configured) — stop instead
    // of spinning forever on the same rows.
    if (result.attempted === 0) {
      finish(
        "error",
        `No calculator work done for ${versionId}. Check the executable path in Settings.`,
      );
      return;
    }

    if (job.force) {
      job.offset += ids.length;
      if (ids.length < BATCH_SIZE) {
        finish("completed");
        return;
      }
      scheduleNext();
      return;
    }

    const remaining = countMissingForQuery(
      db,
      versionId,
      compiled.sql,
      asBindings(compiled.params),
    );

    if (remaining === 0) {
      finish("completed");
      return;
    }

    scheduleNext();
  } catch (err) {
    finish("error", err instanceof Error ? err.message : String(err));
  }
}

export function startManiaRatingBackfill(
  db: Db,
  options: { versionId: string; query?: string; force?: boolean },
): ManiaRatingJobState {
  if (job.status === "running" || job.status === "stopping") {
    return getManiaRatingJobState(db);
  }

  const versionId = options.versionId;
  const query = options.query?.trim() || "mode:mania";
  const force = options.force === true;

  job.status = "running";
  job.versionId = versionId;
  job.query = query;
  job.force = force;
  job.offset = 0;
  job.computedThisRun = 0;
  job.attemptedThisRun = 0;
  job.startedAt = new Date();
  job.finishedAt = null;
  job.error = null;
  job.db = db;

  const ast = parseQuery(query);
  const compiled = compileQuery(ast);
  const pending = force
    ? countMapsForQuery(db, compiled.sql, asBindings(compiled.params))
    : countMissingForQuery(
        db,
        versionId,
        compiled.sql,
        asBindings(compiled.params),
      );

  if (pending === 0) {
    finish("completed");
    return getManiaRatingJobState(db);
  }

  scheduleNext();
  return getManiaRatingJobState(db);
}

export function stopManiaRatingBackfill(db: Db): ManiaRatingJobState {
  if (job.status === "running") {
    job.status = "stopping";
  }
  return getManiaRatingJobState(db);
}
