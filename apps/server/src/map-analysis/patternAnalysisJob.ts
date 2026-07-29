
import type { Db } from "@roxysu/db/types";
import { PATTERN_ALGORITHM } from "@roxysu/pattern-7k";
import { backfillPatternAnalysisSync } from "./computePatternAnalysis";
import { publish } from "../shared/events";

export type PatternAnalysisJobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "error";

export type PatternAnalysisCoverage = {
  total7k: number;
  computed: number;
  missing: number;
  failed: number;
};

export type PatternAnalysisJobState = {
  status: PatternAnalysisJobStatus;
  algorithm: typeof PATTERN_ALGORITHM;
  coverage: PatternAnalysisCoverage;
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
  status: PatternAnalysisJobStatus;
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

/** 7k maps still needing a first successful pattern label for the active algorithm. */
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
        AND ROUND(COALESCE(b.circle_size, 0)) = 7
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
        COUNT(*) AS total7k,
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
        AND ROUND(COALESCE(b.circle_size, 0)) = 7
    `,
    )
    .get(PATTERN_ALGORITHM) as {
    total7k: number;
    computed: number;
    failed: number;
  } | null;

  return {
    total7k: Number(totals?.total7k ?? 0),
    computed: Number(totals?.computed ?? 0),
    missing: countPatternAnalysisMissing(db),
    failed: Number(totals?.failed ?? 0),
  };
}

export function getPatternAnalysisJobState(db: Db): PatternAnalysisJobState {
  return {
    status: job.status,
    algorithm: PATTERN_ALGORITHM,
    coverage: getPatternAnalysisCoverage(db),
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
    const result = backfillPatternAnalysisSync(db, {
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

/** Start background 7k pattern analysis for maps missing the active algorithm. */
export function startPatternAnalysisBackfill(db: Db): PatternAnalysisJobState {
  if (job.status === "running" || job.status === "stopping") {
    return getPatternAnalysisJobState(db);
  }

  job.status = "running";
  job.computedThisRun = 0;
  job.attemptedThisRun = 0;
  job.startedAt = new Date();
  job.finishedAt = null;
  job.error = null;
  job.db = db;

  const missing = countPatternAnalysisMissing(db);
  if (missing === 0) {
    finish("completed");
    return getPatternAnalysisJobState(db);
  }

  scheduleNext();
  return getPatternAnalysisJobState(db);
}

/** Request stop; current batch finishes, then job goes idle. */
export function stopPatternAnalysisBackfill(db: Db): PatternAnalysisJobState {
  if (job.status === "running") {
    job.status = "stopping";
  }
  return getPatternAnalysisJobState(db);
}
