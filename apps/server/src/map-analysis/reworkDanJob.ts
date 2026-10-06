import type { Db } from "@roxysu/db/types";
import {
  REWORK_ALGORITHM,
  backfillReworkDanAsync,
  relabelReworkDanSync,
} from "./computeReworkDan";
import { collectNow } from "./jobYield";
import {
  BACKFILL_MIN_HEADROOM_MB,
  describeMemoryPressure,
  isInMapMemoryPressure,
  memoryHeadroom,
} from "./memoryPressure";
import { publish } from "../shared/events";

export type ReworkDanJobStatus =
  | "idle"
  | "running"
  /** Waiting for the machine to free memory; resumes automatically. */
  | "paused"
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
  /** Lowest free MB (RAM + swap) seen this run. */
  minHeadroomMb: number | null;
  /** Current memory summary, e.g. "212 MB · 19800 MB free". */
  memory: string;
  /** Pause threshold in MB. */
  minHeadroomLimitMb: number;
};

// Batches are re-queried between runs; the per-map yield is what bounds memory.
const BATCH_SIZE = 200;
const YIELD_MS = 5;
/** How often a paused job re-checks for recovered memory. */
const PAUSE_POLL_MS = 5_000;

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
  minHeadroomMb: number | null;
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
  minHeadroomMb: null,
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
    minHeadroomMb: job.minHeadroomMb,
    memory: describeMemoryPressure(),
    minHeadroomLimitMb: BACKFILL_MIN_HEADROOM_MB,
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

function scheduleNext(delayMs = YIELD_MS): void {
  clearTimer();
  job.timer = setTimeout(() => {
    job.timer = null;
    void runBatch();
  }, delayMs);
}

/**
 * Stop starting new work while the machine is low on memory.
 *
 * Polls every 5s; resumes on its own once headroom recovers, so an AFK backfill
 * never has to be babysat.
 */
function pauseForMemory(): void {
  if (job.status !== "paused") {
    job.status = "paused";
    publish({ type: "dashboard.updated" });
  }
  scheduleNext(PAUSE_POLL_MS);
}

function noteHeadroom(): boolean {
  const { headroomMb } = memoryHeadroom();
  job.minHeadroomMb =
    job.minHeadroomMb == null ? headroomMb : Math.min(job.minHeadroomMb, headroomMb);
  // Same tighter ceiling as pattern analysis: this pass builds the difficulty
  // graph synchronously, so the between-map pause has to match the in-map one.
  return isInMapMemoryPressure();
}

/**
 * Async because rating yields after every map. `busy` guards against a second
 * batch starting while one is in flight.
 */
let busy = false;

async function runBatch(): Promise<void> {
  const db = job.db;
  if (!db) {
    finish("error", "Backfill job lost database handle");
    return;
  }

  if (job.status === "stopping") {
    finish("idle");
    return;
  }

  if (job.status === "paused") {
    // Resume only once the machine has room again.
    if (!noteHeadroom()) {
      job.status = "running";
    } else {
      scheduleNext();
      return;
    }
  }

  if (job.status !== "running" || busy) return;

  // Refuse to start a batch while the machine is already tight.
  if (noteHeadroom()) {
    pauseForMemory();
    return;
  }

  busy = true;

  try {
    // Relabel once, on the first batch only, so a floor edit applies before any
    // new work.
    const shouldRelabel = job.relabeledThisRun === 0;
    const result = await backfillReworkDanAsync(db, {
      limit: BATCH_SIZE,
      includeFailed: false,
      skipRelabel: !shouldRelabel,
      withPattern: true,
      shouldContinue: () => !noteHeadroom(),
    });
    job.attemptedThisRun += result.attempted;
    job.computedThisRun += result.succeeded;
    job.relabeledThisRun += result.relabeled;

    if (result.stoppedEarly) {
      // Low memory: yield the machine and resume on its own shortly.
      pauseForMemory();
      return;
    }

    if (result.attempted === 0) {
      finish("completed");
      return;
    }

    scheduleNext();
  } catch (err) {
    finish("error", err instanceof Error ? err.message : String(err));
  } finally {
    busy = false;
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
  job.minHeadroomMb = null;

  if (countReworkDanPending(db) === 0) {
    // Nothing missing, but still refresh labels after a floor edit.
    try {
      job.relabeledThisRun = relabelReworkDanSync(db);
      collectNow();
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