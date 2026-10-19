import { failStaleRunningImportsOlderThan } from "@roxysu/db/stale-imports";
import type { Db } from "@roxysu/db/types";

/** How often the server re-checks for an abandoned `running` import. */
export const STALE_IMPORT_SWEEP_MS = 60_000;

/**
 * Server-side recovery for a realm-reader that died mid-import (F-011).
 * The returned function is cheap to call on every poll tick: it runs the
 * age-gated `failStaleRunningImportsOlderThan` on the first call (server boot)
 * and then at most once per `intervalMs`. The reader's own fail-all-at-start
 * stays in `apps/realm-reader/src/index.ts`.
 *
 * @returns number of imports marked failed by this call (0 when throttled)
 */
export function createStaleImportSweep(
  db: Db,
  intervalMs: number = STALE_IMPORT_SWEEP_MS,
  now: () => number = Date.now,
): () => number {
  let lastRun: number | null = null;
  return () => {
    const t = now();
    if (lastRun != null && t - lastRun < intervalMs) return 0;
    lastRun = t;
    const failed = failStaleRunningImportsOlderThan(db, undefined, t);
    if (failed > 0) {
      console.warn(
        `[sync] marked ${failed} stale running import(s) as failed — realm-reader appears to be down`,
      );
    }
    return failed;
  };
}
