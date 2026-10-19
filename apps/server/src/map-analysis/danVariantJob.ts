
import type { Db } from "@roxysu/db/types";
import { publish, subscribe } from "../shared/events";
import { invalidatePlayerStatsCache } from "../analytics/playerStatsCache";
import {
  backfillDanVariants,
  collectDanVariantCombos,
  type DanVariantCombo,
} from "./computeDanVariants";
import { isMemoryPressure } from "./memoryPressure";

export type DanVariantJobStatus =
  | "idle"
  | "running"
  /** Waiting for the machine to free memory; resumes automatically. */
  | "paused"
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
/** How often a paused job re-checks for recovered memory. */
const PAUSE_POLL_MS = 5_000;

/** Seams for tests; production always uses the defaults. */
const deps = {
  isMemoryPressure: (): boolean => isMemoryPressure(),
  yieldBetween: undefined as (() => Promise<void>) | undefined,
};

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
  /**
   * Fingerprint of the mania score set the last full combo scan covered, or
   * null when no full scan has run in this process.
   */
  fullScanFingerprint: string | null;
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
  fullScanFingerprint: null,
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
 * Cheap identity of the mania score set a full scan reads: row count, newest
 * play, and total mods length (so a remap that rewrites mods is noticed).
 */
function maniaScoreFingerprint(db: Db): string {
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n,
             COALESCE(MAX(s.played_at), 0) AS newest,
             COALESCE(SUM(LENGTH(COALESCE(s.mods, ''))), 0) AS modsLen
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      WHERE s.delete_pending = 0
        AND s.beatmap_id IS NOT NULL
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
    `,
    )
    .get() as { n: number; newest: number; modsLen: number };
  return `${row.n}:${row.newest}:${row.modsLen}`;
}

/**
 * Combos changed by imports newer than the watermark.
 *
 * A null changed_score_ids means "unknown delta" (bootstrap or a large
 * reconcile), not "every score". The full scan runs for it only when no full
 * scan has covered the current mania score set yet; otherwise the boot scan
 * (or an earlier null-delta scan) already queued those combos and re-running
 * it would just re-queue the whole library.
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
    if (row.changedScoreIds == null) {
      if (job.fullScanFingerprint !== maniaScoreFingerprint(db)) {
        enqueueFullScan(db);
      }
      continue;
    }
    const scoreIds = JSON.parse(row.changedScoreIds) as string[];
    for (const combo of collectDanVariantCombos(db, scoreIds)) {
      job.queue.set(comboKey(combo), combo);
    }
  }
}

function comboKey(combo: DanVariantCombo): string {
  return `${combo.beatmapId}|${combo.rate}|${combo.lnOnly ? 1 : 0}`;
}

function finish(status: "completed" | "idle" | "error", error?: string): void {
  clearTimers();
  job.status = status === "idle" ? "idle" : status;
  job.finishedAt = new Date();
  job.error = error ?? null;
  job.db = null;
  publish({ type: "dashboard.updated" });
  // Skill axes skip a modded play until its variant row exists, and the player
  // stats cache ignores dashboard.updated; drop it when rows were written.
  if (job.computedThisRun > 0) invalidatePlayerStatsCache();
}

/**
 * Refuse to start another batch while the machine is low on memory, so an
 * unattended backfill cannot push the desktop into swap exhaustion.
 */
function memoryGuard(): boolean {
  if (!deps.isMemoryPressure()) return false;
  if (job.status === "running") {
    job.status = "paused";
    publish({ type: "dashboard.updated" });
    publish({ type: "jobs.updated" });
  }
  scheduleNext(PAUSE_POLL_MS);
  return true;
}

function scheduleNext(delayMs = YIELD_MS): void {
  if (job.timer != null) clearTimeout(job.timer);
  job.timer = setTimeout(() => {
    job.timer = null;
    void runBatch();
  }, delayMs);
}

/** Re-read after an await: stopDanVariantJob() may have flipped the status. */
function isStopping(): boolean {
  return job.status === "stopping";
}

/** Guards against a second batch starting while one is in flight. */
let busy = false;

async function runBatch(): Promise<void> {
  const db = job.db;
  if (!db) {
    finish("error", "Dan variant job lost database handle");
    return;
  }

  if (job.status === "stopping") {
    finish("idle");
    return;
  }

  if (job.status === "paused") {
    // Resume on our own once the machine has room.
    if (deps.isMemoryPressure()) {
      scheduleNext(PAUSE_POLL_MS);
      return;
    }
    job.status = "running";
  }

  if (job.status !== "running" || busy) return;

  if (memoryGuard()) return;

  busy = true;
  try {
    const batch = [...job.queue.values()].slice(0, BATCH_SIZE);
    const result = await backfillDanVariants(db, {
      limit: BATCH_SIZE,
      combos: batch,
      // Checked before each combo: a whole batch can fill the heap before the
      // next batch-level check ever runs.
      shouldContinue: () => !deps.isMemoryPressure(),
      yieldBetween: deps.yieldBetween,
    });

    job.computedThisRun += result.succeeded;

    if (result.stoppedEarly) {
      // Drop only what ran; the rest (and any combo that was already fresh)
      // is re-examined after the pause.
      for (const combo of result.processed) job.queue.delete(comboKey(combo));
      if (isStopping()) {
        finish("idle");
        return;
      }
      if (!memoryGuard()) scheduleNext();
      return;
    }

    // Every combo in the batch was either computed or already fresh.
    for (const combo of batch) job.queue.delete(comboKey(combo));

    if (job.queue.size === 0) {
      finish("completed");
      return;
    }

    if (isStopping()) {
      finish("idle");
      return;
    }

    scheduleNext();
  } catch (err) {
    finish("error", err instanceof Error ? err.message : String(err));
  } finally {
    busy = false;
  }
}

function startRun(db: Db): void {
  if (
    job.status === "running" ||
    job.status === "paused" ||
    job.status === "stopping"
  ) {
    return;
  }

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

  scheduleNext();
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
  // Fingerprint first: scores written while this synchronous scan runs cannot
  // exist, so the fingerprint always describes what the scan read.
  job.fullScanFingerprint = maniaScoreFingerprint(db);
  for (const combo of collectDanVariantCombos(db)) {
    job.queue.set(comboKey(combo), combo);
  }
}

/** Request stop; current batch finishes, then job goes idle. */
export function stopDanVariantJob(): DanVariantJobState {
  if (job.status === "running" || job.status === "paused") {
    job.status = "stopping";
  }
  return toState();
}

/** Test seams: drive the job with a fake memory probe and a fresh runtime. */
export const __danVariantJobTesting = {
  reset(): void {
    clearTimers();
    busy = false;
    job = {
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
      fullScanFingerprint: null,
    };
    deps.isMemoryPressure = () => isMemoryPressure();
    deps.yieldBetween = undefined;
  },
  setMemoryPressure(fn: () => boolean): void {
    deps.isMemoryPressure = fn;
  },
  setYieldBetween(fn: (() => Promise<void>) | undefined): void {
    deps.yieldBetween = fn;
  },
  queueSize(): number {
    return job.queue.size;
  },
  enqueueFullScan,
  enqueueNewImports,
  startRun,
  runBatch,
  finish,
  cancelTimers: clearTimers,
  state: () => job,
};
