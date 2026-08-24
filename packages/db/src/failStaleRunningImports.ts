import { eq } from "drizzle-orm";
import { imports } from "./schema";
import type { Db } from "./types";

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
