import type { Db } from "@roxysu/db/types";
import { shutdownAnalyticsPipeline } from "./analytics/pipeline";
import {
  getPatternAnalysisJobStatus,
  getReworkDanJobStatus,
  stopDanielDanBackfill,
  stopDanVariantJob,
  stopPatternAnalysisBackfill,
  stopReworkDanBackfill,
  stopSunnyDanBackfill,
} from "./map-analysis";
import { getManiaRatingJobStatus, stopManiaRatingBackfill } from "./mania-rating";
import { stopMirrorBatchJob } from "./mirrors";

export type ShutdownJobsDeps = {
  shutdownAnalytics: (opts: { timeoutMs: number }) => Promise<boolean>;
  /** Cooperative stop requests; each only flags the job (no await needed). */
  stops: Array<() => void>;
  /**
   * Jobs whose batch awaits (calculator child, async engines): an in-flight
   * batch can still write after the stop flag is set, so wait for idle.
   */
  asyncJobStatuses: Array<() => string>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

const DEFAULT_TIMEOUT_MS = 3_000;
const POLL_MS = 50;

function activeStatus(status: string): boolean {
  return status === "running" || status === "stopping";
}

function defaultDeps(db: Db): ShutdownJobsDeps {
  return {
    shutdownAnalytics: shutdownAnalyticsPipeline,
    stops: [
      () => stopDanVariantJob(),
      () => stopSunnyDanBackfill(db),
      () => stopDanielDanBackfill(db),
      () => stopReworkDanBackfill(db),
      () => stopPatternAnalysisBackfill(db),
      () => stopManiaRatingBackfill(db),
      () => stopMirrorBatchJob(),
    ],
    asyncJobStatuses: [
      () => getManiaRatingJobStatus(),
      () => getReworkDanJobStatus(),
      () => getPatternAnalysisJobStatus(),
    ],
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
  };
}

export function shutdownAsyncJobStatuses(db: Db): Array<() => string> {
  return defaultDeps(db).asyncJobStatuses;
}

/**
 * Stop every background writer of the local mirror before `closeDb`:
 * the analytics pipeline (awaited, bounded), then the backfill jobs and the
 * mirror batch job. Returns true when everything went idle within the budget.
 * Never throws: shutdown must reach `closeDb` and `process.exit` regardless.
 */
export async function shutdownBackgroundWork(
  db: Db,
  opts: { timeoutMs?: number; deps?: ShutdownJobsDeps } = {},
): Promise<boolean> {
  const deps = opts.deps ?? defaultDeps(db);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = deps.now() + timeoutMs;

  for (const stop of deps.stops) {
    try {
      stop();
    } catch (err) {
      console.error("[shutdown] job stop failed", err);
    }
  }

  let ok = true;
  try {
    const drained = await deps.shutdownAnalytics({ timeoutMs });
    ok &&= drained;
  } catch (err) {
    console.error("[shutdown] analytics shutdown failed", err);
    ok = false;
  }

  const busy = () => {
    try {
      return deps.asyncJobStatuses.some((read) => activeStatus(read()));
    } catch {
      return false;
    }
  };
  while (busy()) {
    if (deps.now() >= deadline) {
      console.warn("[shutdown] background jobs still running at deadline");
      return false;
    }
    await deps.sleep(POLL_MS);
  }
  return ok;
}
