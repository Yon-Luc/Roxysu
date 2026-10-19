
import type { Db } from "@roxysu/db/types";
import { STALE_RUNNING_MS } from "@roxysu/db/stale-imports";
import { beatmaps, imports, mastery, scores } from "@roxysu/db/schema";
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  max,
} from "drizzle-orm";
import { subscribe, publish, type AppEvent } from "../shared/events";
import { runRetryEngine } from "./retry";
import { runSessionEngine } from "./session";
import { runMasteryEngine } from "./mastery/engine";
import { runStatisticsEngine } from "./statistics";
import { deriveBmsScores } from "../bms/derive";

const DEBOUNCE_MS = 250;
const IMPORT_WAIT_MS = 1_000;
let running = false;
let pending = false;
let pendingForceFull = false;
let pendingImportId: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
/** Set by `shutdownAnalyticsPipeline`: no new run starts, the wait loop exits. */
let stopping = false;
/** Resolves when the current run (if any) has fully finished. */
let runIdle: Promise<void> = Promise.resolve();
let resolveRunIdle: (() => void) | null = null;

export type AnalyticsDelta = {
  /** null → full rebuild for that dimension */
  scoreIds: string[] | null;
  beatmapIds: string[] | null;
  scoresDeleted: number;
  beatmapsDeleted: number;
  beatmapSetsDeleted: number;
  kind: string;
};

function playedAtMs(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  return value;
}

function latestImport(db: Db): ImportGateRow | null {
  return (
    db
      .select({
        status: imports.status,
        startedAt: imports.startedAt,
        progressAt: imports.progressAt,
      })
      .from(imports)
      .orderBy(desc(imports.id))
      .limit(1)
      .get() ?? null
  );
}

type ImportGateRow = {
  status: string;
  startedAt: Date | number;
  /** Null/absent falls back to startedAt (rows from before the heartbeat). */
  progressAt?: Date | number | null;
};

function isStaleRunning(
  row: ImportGateRow | null,
  now: number = Date.now(),
): boolean {
  if (!row || row.status !== "running") return false;
  const stamp = playedAtMs(row.progressAt) ?? playedAtMs(row.startedAt);
  return stamp != null && now - stamp > STALE_RUNNING_MS;
}

/**
 * Whether the analytics pipeline may read the local mirror now.
 * "wait" while the latest import is `running` and its heartbeat is fresh.
 * Raw rows are committed in batches before `finishImport`, so a rebuild
 * would read a partial library. Stale means no `progressAt` (else
 * `startedAt`) for the shared threshold: the writer is presumed dead.
 */
export function importGateDecision(
  row: ImportGateRow | null,
  now: number = Date.now(),
): "proceed" | "wait" {
  if (!row || row.status !== "running") return "proceed";
  return isStaleRunning(row, now) ? "proceed" : "wait";
}

/** Latest import failed/stuck while scores moved past the last successful cursor. */
function importNeedsForcedFull(db: Db): boolean {
  const latest = latestImport(db);
  if (!latest) return false;
  if (latest.status !== "running" && latest.status !== "failed") return false;

  const lastSuccess = db
    .select({ watermarkPlayedAt: imports.watermarkPlayedAt })
    .from(imports)
    .where(eq(imports.status, "success"))
    .orderBy(desc(imports.id))
    .limit(1)
    .get();

  const scoreRow = db
    .select({ n: count(), maxPlayed: max(scores.playedAt) })
    .from(scores)
    .get();
  const maxPlayed = playedAtMs(scoreRow?.maxPlayed);
  if (maxPlayed == null) return false;
  const watermark = playedAtMs(lastSuccess?.watermarkPlayedAt);
  if (watermark == null) return (scoreRow?.n ?? 0) > 0;
  return maxPlayed > watermark;
}

function parseIdJson(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

export function loadAnalyticsDelta(
  db: Db,
  importId?: number | null,
): AnalyticsDelta | null {
  const row = importId
    ? db
        .select()
        .from(imports)
        .where(eq(imports.id, importId))
        .limit(1)
        .get()
    : db.select().from(imports).orderBy(desc(imports.id)).limit(1).get();

  if (!row || row.status !== "success") return null;

  return {
    scoreIds: parseIdJson(row.changedScoreIds),
    beatmapIds: parseIdJson(row.changedBeatmapIds),
    scoresDeleted: row.scoresDeleted,
    beatmapsDeleted: row.beatmapsDeleted,
    beatmapSetsDeleted: row.beatmapSetsDeleted,
    kind: row.kind,
  };
}

/**
 * Block until the latest import is not `running` (or its heartbeat is stale).
 * There is no wait cap that proceeds anyway: the loop ends only when
 * `importGateDecision` says "proceed". A live reader keeps `progressAt`
 * fresh, so this can outlast `startedAt + 10 min`. Callers that must not
 * block the request (settings PATCH) must not await this.
 */
export async function waitForIdleImport(
  readLatest: () => ImportGateRow | null,
  deps: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    pollMs?: number;
    /** Defaults to the pipeline's shutdown flag. */
    shouldStop?: () => boolean;
  } = {},
): Promise<{ waited: boolean }> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = deps.pollMs ?? IMPORT_WAIT_MS;
  let waited = false;
  const shouldStop = deps.shouldStop ?? (() => stopping);
  while (!shouldStop() && importGateDecision(readLatest(), now()) === "wait") {
    if (!waited) {
      console.log("[analytics] import running - deferring pipeline");
      waited = true;
    }
    await sleep(pollMs);
  }
  if (waited) console.log("[analytics] import settled - resuming pipeline");
  return { waited };
}

function needsFullRebuild(delta: AnalyticsDelta | null): boolean {
  if (!delta) return true;
  // Bootstrap / large full sync stores null ID lists.
  if (delta.scoreIds == null || delta.beatmapIds == null) return true;
  // Hard deletes drop rows we need for day/mapper keys — full rebuild is safer.
  if (
    delta.scoresDeleted > 0 ||
    delta.beatmapsDeleted > 0 ||
    delta.beatmapSetsDeleted > 0
  ) {
    return true;
  }
  return false;
}

async function resolveAffectedBeatmapIds(
  db: Db,
  delta: AnalyticsDelta,
): Promise<string[]> {
  const ids = new Set(delta.beatmapIds ?? []);
  if (delta.scoreIds && delta.scoreIds.length > 0) {
    for (const batch of chunk(delta.scoreIds, 500)) {
      const rows = await db
        .select({ beatmapId: scores.beatmapId })
        .from(scores)
        .where(inArray(scores.id, batch));
      for (const row of rows) {
        if (row.beatmapId) ids.add(row.beatmapId);
      }
    }
  }
  return [...ids];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function runAnalyticsPipeline(
  db: Db,
  opts?: { importId?: number | null; forceFull?: boolean },
): Promise<void> {
  if (stopping) return;
  if (running) {
    pending = true;
    pendingForceFull ||= opts?.forceFull === true;
    if (opts?.importId != null) pendingImportId = opts.importId;
    return;
  }
  running = true;
  runIdle = new Promise<void>((resolve) => {
    resolveRunIdle = resolve;
  });
  try {
    let useForceFull = opts?.forceFull === true || pendingForceFull;
    pendingForceFull = false;
    do {
      pending = false;
      const forceFull = useForceFull || pendingForceFull;
      useForceFull = false;
      pendingForceFull = false;
      const targetImportId = forceFull
        ? null
        : pendingImportId ?? opts?.importId ?? null;
      pendingImportId = null;

      await waitForIdleImport(() => latestImport(db));
      if (stopping) break;
      const forceFromStale = !forceFull && importNeedsForcedFull(db);
      const delta =
        forceFull || forceFromStale
          ? null
          : loadAnalyticsDelta(db, targetImportId);
      const full = forceFull || forceFromStale || needsFullRebuild(delta);

      console.log(
        `[analytics] pipeline start (${full ? "full" : "delta"}${
          targetImportId != null ? ` import=${targetImportId}` : ""
        })`,
      );

      if (full || !delta) {
        await runRetryEngine(db);
        await runSessionEngine(db);
        await runMasteryEngine(db);
        await runStatisticsEngine(db);
        await deriveBmsScores(db, null);
      } else {
        const scoresChanged = (delta.scoreIds?.length ?? 0) > 0;
        const beatmapIds = await resolveAffectedBeatmapIds(db, delta);

        if (!scoresChanged && beatmapIds.length === 0) {
          console.log("[analytics] delta empty — skip engines");
        } else if (scoresChanged) {
          // Retry still walks the timeline for correctness, but only rewrites
          // metrics for affected beatmaps. The session engine repairs only the
          // sessions these scores touch (full rebuild if they do not add up).
          if (beatmapIds.length > 0) {
            await runRetryEngine(db, { beatmapIds });
          } else {
            await runRetryEngine(db);
          }
          await runSessionEngine(db, {
            scoreIds: delta.scoreIds ?? undefined,
          });

          // After migration 0026, backfill best_score/best_misses once for the
          // whole library instead of leaving NULL on untouched maps.
          const needsPlayStatBackfill = db
            .select({ beatmapId: mastery.beatmapId })
            .from(mastery)
            .where(
              and(gt(mastery.playCount, 0), isNull(mastery.bestScore)),
            )
            .limit(1)
            .get();
          if (needsPlayStatBackfill || beatmapIds.length === 0) {
            await runMasteryEngine(db);
          } else {
            await runMasteryEngine(db, { beatmapIds });
          }
          await runStatisticsEngine(db, { scoreIds: delta.scoreIds ?? [] });
          await deriveBmsScores(db, delta.scoreIds ?? []);
        } else {
          // Mapper username/online id may have changed on the map.
          const mapperRows = await db
            .select({ mapperOnlineId: beatmaps.mapperOnlineId })
            .from(beatmaps)
            .where(
              and(
                inArray(beatmaps.id, beatmapIds),
                isNotNull(beatmaps.mapperOnlineId),
              ),
            );
          const mapperIds = [
            ...new Set(
              mapperRows
                .map((r) => r.mapperOnlineId)
                .filter((id): id is number => id != null),
            ),
          ];
          if (mapperIds.length > 0) {
            await runStatisticsEngine(db, { mapperOnlineIds: mapperIds });
          }
        }
      }

      publish({ type: "dashboard.updated" });
      console.log("[analytics] pipeline done");
    } while (pending && !stopping);
  } catch (err) {
    console.error("[analytics] pipeline error", err);
  } finally {
    running = false;
    resolveRunIdle?.();
    resolveRunIdle = null;
  }
}

/** Whether a pipeline run is in flight (including waiting for an import). */
export function isAnalyticsPipelineRunning(): boolean {
  return running;
}

/**
 * Stop the pipeline for process shutdown: clear the debounce and boot timers,
 * refuse new runs, and wait for the in-flight run to finish (bounded). A run
 * waiting on a `running` import exits immediately; a run inside an engine
 * finishes that engine pass (engines have no abort hook) and then stops.
 * Returns false when the timeout elapsed with the run still in flight.
 * `startAnalyticsPipeline` clears the stopping flag again.
 */
export async function shutdownAnalyticsPipeline(
  opts: { timeoutMs?: number } = {},
): Promise<boolean> {
  stopping = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  pending = false;
  pendingForceFull = false;
  if (!running) return true;
  const timeoutMs = opts.timeoutMs ?? 3_000;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const drained = await Promise.race([
    runIdle.then(() => true),
    new Promise<boolean>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (!drained) console.warn("[analytics] shutdown timed out with a run in flight");
  return drained;
}

/** Test-only: clear the shutdown flag so other tests can run the pipeline. */
export function resetAnalyticsPipelineShutdownForTests(): void {
  stopping = false;
}

function schedule(db: Db, importId?: number) {
  if (stopping) return;
  if (importId != null) pendingImportId = importId;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runAnalyticsPipeline(db, { importId: pendingImportId });
  }, DEBOUNCE_MS);
}

function shouldRun(event: AppEvent): boolean {
  return (
    event.type === "sync.finished" ||
    event.type === "score.imported" ||
    event.type === "score.updated"
  );
}

/** Subscribe to import events and run the analytics pipeline (debounced). */
export function startAnalyticsPipeline(db: Db): () => void {
  // Defer boot work so Home's first paint is not fighting a full SQLite wipe.
  // Use delta / needsFullRebuild — never forceFull on every launch.
  const BOOT_IDLE_MS = 8_000;
  stopping = false;
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void runAnalyticsPipeline(db);
  }, BOOT_IDLE_MS);

  return subscribe((event) => {
    if (!shouldRun(event)) return;
    const importId =
      event.type === "sync.finished" ? event.importId : undefined;
    schedule(db, importId);
  });
}
