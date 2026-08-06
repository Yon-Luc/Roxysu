import type { Db } from "@roxysu/db/types";
import {
  DANIEL_ALGORITHM,
  backfillDanielDanSync,
} from "./computeDanielDan";
import { publish } from "../shared/events";

export type DanielDanJobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "error";

export type DanielDanCoverage = {
  fourKTotal: number;
  computed: number;
  missing: number;
  failed: number;
};

export type DanielDanJobState = {
  status: DanielDanJobStatus;
  coverage: DanielDanCoverage;
  computedThisRun: number;
  attemptedThisRun: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  batchSize: number;
};

const BATCH_SIZE = 40;
const YIELD_MS = 10;

let job: {
  status: DanielDanJobStatus;
  computedThisRun: number;
  attemptedThisRun: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  db: Db | null;
} = {
  status: "idle",
  computedThisRun: 0,
  attemptedThisRun: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  timer: null,
  db: null,
};

export function countDanielDanMissing(db: Db): number {
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND CAST(b.circle_size AS INTEGER) = 4
        AND (
          dr.beatmap_id IS NULL
          OR (
            b.hash IS NOT NULL
            AND dr.beatmap_hash IS NOT NULL
            AND dr.beatmap_hash != b.hash
          )
        )
    `,
    )
    .get(DANIEL_ALGORITHM) as { n: number } | null;
  return Number(row?.n ?? 0);
}

export function getDanielDanCoverage(db: Db): DanielDanCoverage {
  const totals = db.$client
    .query(
      `
      SELECT
        COUNT(*) AS fourKTotal,
        SUM(
          CASE
            WHEN dr.est_diff IS NOT NULL
              AND (
                b.hash IS NULL
                OR dr.beatmap_hash IS NULL
                OR dr.beatmap_hash = b.hash
              )
            THEN 1 ELSE 0
          END
        ) AS computed,
        SUM(
          CASE
            WHEN dr.beatmap_id IS NOT NULL
              AND dr.est_diff IS NULL
              AND dr.error IS NOT NULL
            THEN 1 ELSE 0
          END
        ) AS failed
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND CAST(b.circle_size AS INTEGER) = 4
    `,
    )
    .get(DANIEL_ALGORITHM) as {
    fourKTotal: number;
    computed: number;
    failed: number;
  } | null;

  const fourKTotal = Number(totals?.fourKTotal ?? 0);
  const computed = Number(totals?.computed ?? 0);
  const failed = Number(totals?.failed ?? 0);
  const missing = countDanielDanMissing(db);

  return { fourKTotal, computed, missing, failed };
}

export function getDanielDanJobState(db: Db): DanielDanJobState {
  return {
    status: job.status,
    coverage: getDanielDanCoverage(db),
    computedThisRun: job.computedThisRun,
    attemptedThisRun: job.attemptedThisRun,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error,
    batchSize: BATCH_SIZE,
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
    runBatch();
  }, YIELD_MS);
}

function runBatch(): void {
  const db = job.db;
  if (!db) {
    finish("error", "Backfill job lost database handle");
    return;
  }

  if (job.status === "stopping") {
    finish("idle");
    return;
  }

  if (job.status !== "running") return;

  try {
    const result = backfillDanielDanSync(db, {
      limit: BATCH_SIZE,
      includeFailed: false,
    });
    job.attemptedThisRun += result.attempted;
    job.computedThisRun += result.succeeded;

    if (result.attempted === 0 || result.remaining === 0) {
      finish("completed");
      return;
    }

    scheduleNext();
  } catch (err) {
    finish("error", err instanceof Error ? err.message : String(err));
  }
}

export function startDanielDanBackfill(db: Db): DanielDanJobState {
  if (job.status === "running" || job.status === "stopping") {
    return getDanielDanJobState(db);
  }

  job.status = "running";
  job.computedThisRun = 0;
  job.attemptedThisRun = 0;
  job.startedAt = new Date();
  job.finishedAt = null;
  job.error = null;
  job.db = db;

  const missing = countDanielDanMissing(db);
  if (missing === 0) {
    finish("completed");
    return getDanielDanJobState(db);
  }

  scheduleNext();
  return getDanielDanJobState(db);
}

export function stopDanielDanBackfill(db: Db): DanielDanJobState {
  if (job.status === "running") {
    job.status = "stopping";
  }
  return getDanielDanJobState(db);
}
