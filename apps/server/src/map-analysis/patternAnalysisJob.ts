
import type { Db } from "@roxysu/db/types";
import { PATTERN_ALGORITHM } from "@roxysu/mania-pattern-analysis";
import { backfillPatternAnalysis } from "./computePatternAnalysis";
import { publish } from "../shared/events";
import {
  describeMemoryPressure,
  isInMapMemoryPressure,
  memoryHeadroom,
} from "./memoryPressure";

export type PatternAnalysisJobStatus =
  | "idle"
  | "running"
  /** Waiting for the machine to free memory; resumes automatically. */
  | "paused"
  | "stopping"
  | "completed"
  | "error";

export type PatternAnalysisJobMode = "missing" | "recompute";

export type PatternAnalysisCoverage = {
  totalMania: number;
  /** @deprecated Use totalMania */
  total7k: number;
  computed: number;
  missing: number;
  failed: number;
};

export type PatternAnalysisJobState = {
  status: PatternAnalysisJobStatus;
  mode: PatternAnalysisJobMode;
  algorithm: typeof PATTERN_ALGORITHM;
  coverage: PatternAnalysisCoverage;
  computedThisRun: number;
  attemptedThisRun: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  batchSize: number;
  /** Current memory summary, e.g. "212 MB · 19800 MB free". */
  memory: string;
};

const BATCH_SIZE = 40;
const YIELD_MS = 10;
/** How often a paused job re-checks for recovered memory. */
const PAUSE_POLL_MS = 5_000;

let job: {
  status: PatternAnalysisJobStatus;
  mode: PatternAnalysisJobMode;
  computedThisRun: number;
  attemptedThisRun: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  db: Db | null;
  minHeadroomMb: number | null;
} = {
  status: "idle",
  mode: "missing",
  computedThisRun: 0,
  attemptedThisRun: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  timer: null,
  db: null,
  minHeadroomMb: null,
};

/** Mania maps still needing a first successful pattern label for the active algorithm. */
export function countPatternAnalysisMissing(db: Db): number {
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_pattern_analysis pa
        ON pa.beatmap_id = b.id AND pa.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND (
          pa.beatmap_id IS NULL
          OR (
            b.hash IS NOT NULL
            AND pa.beatmap_hash IS NOT NULL
            AND pa.beatmap_hash != b.hash
          )
        )
    `,
    )
    .get(PATTERN_ALGORITHM) as { n: number } | null;
  return Number(row?.n ?? 0);
}

export function getPatternAnalysisCoverage(db: Db): PatternAnalysisCoverage {
  const totals = db.$client
    .query(
      `
      SELECT
        COUNT(*) AS totalMania,
        SUM(
          CASE
            WHEN pa.dominant_pattern IS NOT NULL
              AND (
                b.hash IS NULL
                OR pa.beatmap_hash IS NULL
                OR pa.beatmap_hash = b.hash
              )
            THEN 1 ELSE 0
          END
        ) AS computed,
        SUM(
          CASE
            WHEN pa.beatmap_id IS NOT NULL
              AND pa.dominant_pattern IS NULL
              AND pa.error IS NOT NULL
            THEN 1 ELSE 0
          END
        ) AS failed
      FROM beatmaps b
      LEFT JOIN beatmap_pattern_analysis pa
        ON pa.beatmap_id = b.id AND pa.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
    `,
    )
    .get(PATTERN_ALGORITHM) as {
    totalMania: number;
    computed: number;
    failed: number;
  } | null;

  const totalMania = Number(totals?.totalMania ?? 0);
  return {
    totalMania,
    total7k: totalMania,
    computed: Number(totals?.computed ?? 0),
    missing: countPatternAnalysisMissing(db),
    failed: Number(totals?.failed ?? 0),
  };
}

export function getPatternAnalysisJobState(db: Db): PatternAnalysisJobState {
  return {
    status: job.status,
    mode: job.mode,
    algorithm: PATTERN_ALGORITHM,
    coverage: getPatternAnalysisCoverage(db),
    computedThisRun: job.computedThisRun,
    attemptedThisRun: job.attemptedThisRun,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error,
    batchSize: BATCH_SIZE,
    memory: describeMemoryPressure(),
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

/**
 * Refuse to start another batch while the machine is low on memory, so an
 * unattended backfill cannot push the desktop into swap exhaustion (where the
 * OOM killer starts taking unrelated processes, e.g. the user's terminal).
 */
function memoryGuard(): boolean {
  if (!noteHeadroom()) return false;
  if (job.status !== "paused") {
    job.status = "paused";
    publish({ type: "dashboard.updated" });
  }
  scheduleNext(PAUSE_POLL_MS);
  return true;
}

/** Record the lowest free MB seen this run, then report current pressure. */
function noteHeadroom(): boolean {
  const { headroomMb } = memoryHeadroom();
  job.minHeadroomMb =
    job.minHeadroomMb == null
      ? headroomMb
      : Math.min(job.minHeadroomMb, headroomMb);
  // Tighter than the shared backfill ceiling: this job rates one chart
  // synchronously, so it must stop before a single graph can reach the limit.
  return isInMapMemoryPressure();
}

function scheduleNext(delayMs = YIELD_MS): void {
  clearTimer();
  job.timer = setTimeout(() => {
    job.timer = null;
    void runBatch();
  }, delayMs);
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
    // Resume on our own once the machine has room.
    if (noteHeadroom()) {
      scheduleNext(PAUSE_POLL_MS);
      return;
    }
    job.status = "running";
  }

  if (job.status !== "running" || busy) return;

  if (memoryGuard()) return;

  busy = true;

  try {
    const result = await backfillPatternAnalysis(db, {
      limit: BATCH_SIZE,
      includeFailed: false,
      // Checked between maps: a whole synchronous batch can fill the heap
      // before the next batch-level check ever runs.
      shouldContinue: () => !noteHeadroom(),
    });
    job.attemptedThisRun += result.attempted;
    job.computedThisRun += result.succeeded;

    if (result.stoppedEarly) {
      // Low memory: yield the machine and resume on our own shortly.
      memoryGuard();
      scheduleNext(PAUSE_POLL_MS);
      return;
    }

    if (result.attempted === 0 || result.remaining === 0) {
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

function startJob(
  db: Db,
  mode: PatternAnalysisJobMode,
): PatternAnalysisJobState {
  if (job.status === "running" || job.status === "stopping") {
    return getPatternAnalysisJobState(db);
  }

  if (mode === "recompute") {
    // Clear active-algorithm cache so every mania map is treated as missing.
    db.$client
      .query(`DELETE FROM beatmap_pattern_analysis WHERE algorithm = ?`)
      .run(PATTERN_ALGORITHM);
  }

  job.status = "running";
  job.mode = mode;
  job.computedThisRun = 0;
  job.attemptedThisRun = 0;
  job.startedAt = new Date();
  job.finishedAt = null;
  job.error = null;
  job.db = db;

  const pending = countPatternAnalysisMissing(db);
  if (pending === 0) {
    finish("completed");
    return getPatternAnalysisJobState(db);
  }

  scheduleNext();
  return getPatternAnalysisJobState(db);
}

/** Start background mania pattern analysis for maps missing the active algorithm. */
export function startPatternAnalysisBackfill(db: Db): PatternAnalysisJobState {
  return startJob(db, "missing");
}

/** Force-recompute pattern analysis for every mania map (new labels / algorithm tweaks). */
export function startPatternAnalysisRecompute(db: Db): PatternAnalysisJobState {
  return startJob(db, "recompute");
}

/** Request stop; current batch finishes, then job goes idle. */
export function stopPatternAnalysisBackfill(db: Db): PatternAnalysisJobState {
  if (job.status === "running") {
    job.status = "stopping";
  }
  return getPatternAnalysisJobState(db);
}
