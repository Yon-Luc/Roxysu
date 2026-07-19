import type { Db } from "@roxysu/db/client.bun";
import {
  SUNNY_ALGORITHM,
  backfillSunnyDanSync,
  relabelSunnyDanSync,
} from "./computeSunnyDan";
import { publish } from "../shared/events";

export type SunnyDanJobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "error";

export type SunnyDanCoverage = {
  maniaTotal: number;
  computed: number;
  missing: number;
  failed: number;
};

export type SunnyDanJobState = {
  status: SunnyDanJobStatus;
  coverage: SunnyDanCoverage;
  /** Maps computed in the current/last run. */
  computedThisRun: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  batchSize: number;
};

const BATCH_SIZE = 40;
const YIELD_MS = 10;

let job: {
  status: SunnyDanJobStatus;
  computedThisRun: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  db: Db | null;
} = {
  status: "idle",
  computedThisRun: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  timer: null,
  db: null,
};

/** Mania maps still needing a successful Sunny dan label. */
export function countSunnyDanMissing(db: Db): number {
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND (
          dr.beatmap_id IS NULL
          OR dr.est_diff IS NULL
          OR (
            b.hash IS NOT NULL
            AND dr.beatmap_hash IS NOT NULL
            AND dr.beatmap_hash != b.hash
          )
        )
    `,
    )
    .get(SUNNY_ALGORITHM) as { n: number } | null;
  return Number(row?.n ?? 0);
}

export function getSunnyDanCoverage(db: Db): SunnyDanCoverage {
  const totals = db.$client
    .query(
      `
      SELECT
        COUNT(*) AS maniaTotal,
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
    `,
    )
    .get(SUNNY_ALGORITHM) as {
    maniaTotal: number;
    computed: number;
    failed: number;
  } | null;

  const maniaTotal = Number(totals?.maniaTotal ?? 0);
  const computed = Number(totals?.computed ?? 0);
  const failed = Number(totals?.failed ?? 0);
  const missing = countSunnyDanMissing(db);

  return { maniaTotal, computed, missing, failed };
}

export function getSunnyDanJobState(db: Db): SunnyDanJobState {
  return {
    status: job.status,
    coverage: getSunnyDanCoverage(db),
    computedThisRun: job.computedThisRun,
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
    const result = backfillSunnyDanSync(db, {
      limit: BATCH_SIZE,
      includeFailed: true,
    });
    job.computedThisRun += result.computed;

    if (result.computed === 0 || result.remaining === 0) {
      finish("completed");
      return;
    }

    scheduleNext();
  } catch (err) {
    finish("error", err instanceof Error ? err.message : String(err));
  }
}

/** Start background Sunny dan calculation for all missing mania maps. */
export function startSunnyDanBackfill(db: Db): SunnyDanJobState {
  if (job.status === "running" || job.status === "stopping") {
    return getSunnyDanJobState(db);
  }

  relabelSunnyDanSync(db);

  job.status = "running";
  job.computedThisRun = 0;
  job.startedAt = new Date();
  job.finishedAt = null;
  job.error = null;
  job.db = db;

  const missing = countSunnyDanMissing(db);
  if (missing === 0) {
    finish("completed");
    return getSunnyDanJobState(db);
  }

  scheduleNext();
  return getSunnyDanJobState(db);
}

/** Request stop; current batch finishes, then job goes idle. */
export function stopSunnyDanBackfill(db: Db): SunnyDanJobState {
  if (job.status === "running") {
    job.status = "stopping";
  }
  return getSunnyDanJobState(db);
}
