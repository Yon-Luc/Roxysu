import { and, eq, lt } from "drizzle-orm";
import { imports } from "./schema";
import type { Db } from "./types";

/**
 * A `running` import older than this is treated as abandoned. Shared by the
 * analytics pipeline gate (`isStaleRunning`) and `failStaleRunningImportsOlderThan`.
 */
export const STALE_RUNNING_MS = 10 * 60_000;

/** `imports.error` written by `failStaleRunningImportsOlderThan`. */
export const STALE_RUNNING_IMPORT_ERROR =
  "stale running (no finish within threshold; realm-reader down?)";

/**
 * Hard kill leaves `imports.status = 'running'` forever. Safe to fail every
 * running row on realm-reader start: this process is the only writer.
 *
 * @returns number of rows marked failed
 */
export function failStaleRunningImports(db: Db): number {
  const rows = db
    .select({ id: imports.id })
    .from(imports)
    .where(eq(imports.status, "running"))
    .all();
  if (rows.length === 0) return 0;

  const now = new Date();
  for (const row of rows) {
    db.update(imports)
      .set({
        status: "failed",
        finishedAt: now,
        error: "stale running (reader restart)",
      })
      .where(eq(imports.id, row.id))
      .run();
  }
  return rows.length;
}

/**
 * Age-gated variant for processes that are NOT the realm-reader (the server).
 * Fails only `running` imports whose `started_at` is older than `maxAgeMs`, so
 * a live reader's in-flight import is left alone. A reader that is still alive
 * overwrites the row with its final status by id when it finishes.
 *
 * @returns number of rows marked failed
 */
export function failStaleRunningImportsOlderThan(
  db: Db,
  maxAgeMs: number = STALE_RUNNING_MS,
  now: number = Date.now(),
): number {
  const cutoff = new Date(now - maxAgeMs);
  const rows = db
    .select({ id: imports.id })
    .from(imports)
    .where(and(eq(imports.status, "running"), lt(imports.startedAt, cutoff)))
    .all();
  if (rows.length === 0) return 0;

  const finishedAt = new Date(now);
  for (const row of rows) {
    db.update(imports)
      .set({
        status: "failed",
        finishedAt,
        error: STALE_RUNNING_IMPORT_ERROR,
      })
      .where(and(eq(imports.id, row.id), eq(imports.status, "running")))
      .run();
  }
  return rows.length;
}
