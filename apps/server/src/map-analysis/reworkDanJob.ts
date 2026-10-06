import type { Db } from "@roxysu/db/types";
import {
  REWORK_ALGORITHM,
  backfillReworkDanSync,
  relabelReworkDanSync,
} from "./computeReworkDan";
import { publish } from "../shared/events";

export type ReworkDanJobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "error";

export type ReworkDanCoverage = {
  /** All mania maps (every key mode — the rework table covers more than 4K). */
  maniaTotal: number;
  computed: number;
  missing: number;
  failed: number;
};

export type ReworkDanJobState = {
  status: ReworkDanJobStatus;
  coverage: ReworkDanCoverage;
  computedThisRun: number;
  attemptedThisRun: number;
  /** Labels rewritten from `dans.json` at the start of this/last run. */
  relabeledThisRun: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  batchSize: number;
};

const BATCH_SIZE = 25;
const YIELD_MS = 10;

let job: {
  status: ReworkDanJobStatus;
  computedThisRun: number;
  attemptedThisRun: number;
  relabeledThisRun: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  db: Db | null;
} = {
  status: "idle",
  computedThisRun: 0,
  attemptedThisRun: 0,
  relabeledThisRun: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  timer: null,
  db: null,
};

export function countReworkDanPending(db: Db): number {
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
          OR (
            b.hash IS NOT NULL
            AND dr.beatmap_hash IS NOT NULL
            AND dr.beatmap_hash != b.hash
          )
        )
    `,
    )
    .get(REWORK_ALGORITHM) as { n: number } | null;
  return Number(row?.n ?? 0);
}

export function getReworkDanCoverage(db: Db): ReworkDanCoverage {
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
    .get(REWORK_ALGORITHM) as {
    maniaTotal: number;
    computed: number;
    failed: number;
  } | null;

  return {
    maniaTotal: Number(totals?.maniaTotal ?? 0),
    computed: Number(totals?.computed ?? 0),
    missing: countReworkDanPending(db),
    failed: Number(totals?.failed ?? 0),
  };
}

export function getReworkDanJobState(db: Db): ReworkDanJobState {
  return {
    status: job.status,
    coverage: getReworkDanCoverage(db),
    computedThisRun: job.computedThisRun,
    attemptedThisRun: job.attemptedThisRun,
    relabeledThisRun: job.relabeledThisRun,
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
  job.status = status;
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
    const result = backfillReworkDanSync(db, {
      limit: BATCH_SIZE,
      includeFailed: false,
      skipRelabel: job.relabeledThisRun === 0,
    });
    job.attemptedThisRun += result.attempted;
    job.computedThisRun += result.succeeded;
    job.relabeledThisRun += result.relabeled;

    if (result.attempted === 0 || result.remaining === 0) {
      finish("completed");
      return;
    }

    scheduleNext();
  } catch (err) {
    finish("error", err instanceof Error ? err.message : String(err));
  }
}

/** Relabel cached rows from the current `dans.json` without re-estimating. */
export function relabelReworkDan(db: Db): number {
  return relabelReworkDanSync(db);
}

export function startReworkDanBackfill(db: Db): ReworkDanJobState {
  if (job.status === "running" || job.status === "stopping") {
    return getReworkDanJobState(db);
  }

  job.status = "running";
  job.computedThisRun = 0;
  job.attemptedThisRun = 0;
  job.relabeledThisRun = 0;
  job.startedAt = new Date();
  job.finishedAt = null;
  job.error = null;
  job.db = db;

  if (countReworkDanPending(db) === 0) {
    // Nothing missing, but still refresh labels after a floor edit.
    try {
      job.relabeledThisRun = relabelReworkDanSync(db);
    } catch (err) {
      finish("error", err instanceof Error ? err.message : String(err));
      return getReworkDanJobState(db);
    }
    finish("completed");
    return getReworkDanJobState(db);
  }

  scheduleNext();
  return getReworkDanJobState(db);
}

export function stopReworkDanBackfill(db: Db): ReworkDanJobState {
  if (job.status === "running") {
    job.status = "stopping";
  }
  return getReworkDanJobState(db);
}