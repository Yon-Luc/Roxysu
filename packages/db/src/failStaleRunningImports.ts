import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
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
 * Fails only `running` imports with no heartbeat (`progress_at`, else
 * `started_at`) for `maxAgeMs`. A live reader touches `progress_at` per batch,
 * so a long import is not failed. A reader that is still alive and has not
 * been swept overwrites the row when it finishes (`finishImport` requires
 * `status = running`).
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
    .where(
      and(
        eq(imports.status, "running"),
        or(
          and(isNotNull(imports.progressAt), lt(imports.progressAt, cutoff)),
          and(isNull(imports.progressAt), lt(imports.startedAt, cutoff)),
        ),
      ),
    )
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
