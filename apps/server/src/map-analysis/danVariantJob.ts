
import type { Db } from "@roxysu/db/types";
import { publish, subscribe } from "../shared/events";
import {
  backfillDanVariantsSync,
  collectDanVariantCombos,
  type DanVariantCombo,
} from "./computeDanVariants";

export type DanVariantJobStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "error";

export type DanVariantJobState = {
  status: DanVariantJobStatus;
  pending: number;
  computedThisRun: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  batchSize: number;
};

const BATCH_SIZE = 20;
const YIELD_MS = 10;
const DEBOUNCE_MS = 2_000;

type JobRuntime = {
  status: DanVariantJobStatus;
  queue: Map<string, DanVariantCombo>;
  computedThisRun: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  db: Db | null;
  lastImportId: number;
};

let job: JobRuntime = {
  status: "idle",
  queue: new Map(),
  computedThisRun: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  timer: null,
  debounceTimer: null,
  db: null,
  lastImportId: -1,
};

function clearTimers(): void {
  if (job.timer != null) {
    clearTimeout(job.timer);
    job.timer = null;
  }
  if (job.debounceTimer != null) {
    clearTimeout(job.debounceTimer);
    job.debounceTimer = null;
  }
}

function toState(): DanVariantJobState {
  return {
    status: job.status,
    pending: job.queue.size,
    computedThisRun: job.computedThisRun,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    error: job.error,
    batchSize: BATCH_SIZE,
  };
}

/** Current job status (for Settings / diagnostics surfaces). */
export function getDanVariantJobState(): DanVariantJobState {
  return toState();
}

/**
 * Combos changed by imports newer than the watermark (null changed_score_ids
 * means "large import" → fall back to a full score scan).
 */
function enqueueNewImports(db: Db): void {
  const imports = db.$client
    .query(
      `
      SELECT id AS id, changed_score_ids AS changedScoreIds
      FROM imports
      WHERE id > ? AND status = 'success'
      ORDER BY id
    `,
    )
    .all(job.lastImportId < 0 ? 0 : job.lastImportId) as Array<{
    id: number;
    changedScoreIds: string | null;
  }>;

  for (const row of imports) {
    job.lastImportId = Math.max(job.lastImportId, row.id);
    const scoreIds =
      row.changedScoreIds == null
        ? null
        : (JSON.parse(row.changedScoreIds) as string[]);
    for (const combo of collectDanVariantCombos(db, scoreIds ?? undefined)) {
      job.queue.set(`${combo.beatmapId}|${combo.rate}|${combo.lnOnly ? 1 : 0}`, combo);
    }
  }
}

function finish(status: "completed" | "idle" | "error", error?: string): void {
  clearTimers();
  job.status = status === "idle" ? "idle" : status;
  job.finishedAt = new Date();
  job.error = error ?? null;
  job.db = null;
  publish({ type: "dashboard.updated" });
}

function runBatch(): void {
  const db = job.db;
  if (!db) {
    finish("error", "Dan variant job lost database handle");
    return;
  }

  if (job.status === "stopping") {
    finish("idle");
    return;
  }

  if (job.status !== "running") return;

  try {
    const result = backfillDanVariantsSync(db, {
      limit: BATCH_SIZE,
      combos: [...job.queue.values()],
    });

    // Drop processed combos from the queue (recomputed rows are now fresh).
    let dropped = 0;
    for (const key of [...job.queue.keys()]) {
      if (dropped >= BATCH_SIZE) break;
      job.queue.delete(key);
      dropped += 1;
    }

    job.computedThisRun += result.succeeded;

    if (job.queue.size === 0 || result.attempted === 0) {
      finish("completed");
      return;
    }

    job.timer = setTimeout(() => {
      job.timer = null;
      runBatch();
    }, YIELD_MS);
  } catch (err) {
    finish("error", err instanceof Error ? err.message : String(err));
  }
}

function startRun(db: Db): void {
  if (job.status === "running" || job.status === "stopping") return;

  job.status = job.queue.size > 0 ? "running" : "completed";
  job.computedThisRun = 0;
  job.startedAt = new Date();
  job.finishedAt = null;
  job.error = null;
  job.db = db;

  if (job.status === "completed") {
    finish("completed");
    return;
  }

  job.timer = setTimeout(() => {
    job.timer = null;
    runBatch();
  }, YIELD_MS);
}

function handleEvent(db: Db, importId?: number): void {
  try {
    enqueueNewImports(db);
    if (importId != null) job.lastImportId = Math.max(job.lastImportId, importId);
  } catch (err) {
    console.error(
      "[dan-variants] combo collection failed",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  if (job.queue.size === 0) return;
  startRun(db);
}

/**
 * One-time repair: rows with algorithm='daniel' AND ln_only=1 written before
 * the Daniel estimator learned the Invert/Hold Off conversions were rated on
 * the unconverted chart. Drop them once so the boot full scan recomputes them.
 */
function invalidatePreConversionDanielVariants(db: Db): void {
  const flag = "dan_variants.daniel_cvt_recompute";
  try {
    const done = db.$client
      .query(`SELECT value FROM settings WHERE key = ?`)
      .get(flag) as { value: string } | null;
    if (done?.value === "1") return;
    db.$client
      .query(
        `DELETE FROM beatmap_dan_rating_variants WHERE algorithm = 'daniel' AND ln_only = 1`,
      )
      .run();
    db.$client
      .query(
        `INSERT INTO settings (key, value) VALUES (?, '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(flag);
  } catch (err) {
    console.error(
      "[dan-variants] daniel conversion invalidation failed",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Subscribe to import events and lazily compute dan difficulty variants for
 * modded plays. Runs fully in the background — never on a request path.
 */
export function startDanVariantJob(db: Db): () => void {
  job.db = db;
  invalidatePreConversionDanielVariants(db);
  const latest = db.$client
    .query(`SELECT COALESCE(MAX(id), 0) AS n FROM imports WHERE status = 'success'`)
    .get() as { n: number } | null;
  job.lastImportId = Number(latest?.n ?? 0);

  // Boot pass: catch anything played before this server session.
  try {
    enqueueFullScan(db);
  } catch (err) {
    console.error(
      "[dan-variants] boot scan failed",
      err instanceof Error ? err.message : err,
    );
  }
  if (job.queue.size > 0) startRun(db);

  return subscribe((event) => {
    if (
      event.type !== "sync.finished" &&
      event.type !== "score.imported" &&
      event.type !== "score.updated"
    ) {
      return;
    }
    if (job.debounceTimer != null) clearTimeout(job.debounceTimer);
    job.debounceTimer = setTimeout(() => {
      job.debounceTimer = null;
      handleEvent(db, event.type === "sync.finished" ? event.importId : undefined);
    }, DEBOUNCE_MS);
  });
}

function enqueueFullScan(db: Db): void {
  for (const combo of collectDanVariantCombos(db)) {
    job.queue.set(`${combo.beatmapId}|${combo.rate}|${combo.lnOnly ? 1 : 0}`, combo);
  }
}

/** Request stop; current batch finishes, then job goes idle. */
export function stopDanVariantJob(): DanVariantJobState {
  if (job.status === "running") {
    job.status = "stopping";
  }
  return toState();
}
