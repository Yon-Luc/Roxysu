import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { Db } from "./types";

/** Thrown by `waitForSchemaCurrent` when the migrator never finished in time. */
export class SchemaNotCurrentError extends Error {
  constructor(
    readonly expected: number,
    readonly applied: number | null,
    readonly waitedMs: number,
  ) {
    super(
      `local mirror schema is not current after ${waitedMs} ms ` +
        `(applied migration ${applied ?? "none"}, expected ${expected}). ` +
        "The migrating process (apps/server) must start first; start it, " +
        "or set ROXYSU_READER_MIGRATE=1 on the realm-reader to migrate there.",
    );
    this.name = "SchemaNotCurrentError";
  }
}

/** True when the env flag asks this process not to run `migrate()`. */
export function skipMigrateFromEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = env.ROXYSU_SKIP_MIGRATE?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Newest migration timestamp (`when` in `meta/_journal.json`). Drizzle stores
 * the same value as `created_at` in `__drizzle_migrations`, so the schema is
 * current when the applied maximum is >= this.
 */
export function expectedMigrationMillis(migrationsFolder: string): number {
  const raw = readFileSync(
    path.join(migrationsFolder, "meta", "_journal.json"),
    "utf8",
  );
  const journal = JSON.parse(raw) as { entries?: { when: number }[] };
  let max = 0;
  for (const e of journal.entries ?? []) if (e.when > max) max = e.when;
  return max;
}

/** Newest applied migration timestamp, or null when none / table missing. */
export function appliedMigrationMillis(db: Db): number | null {
  try {
    const rows = db.all<{ m: number | null }>(
      sql`SELECT MAX(created_at) AS m FROM __drizzle_migrations`,
    );
    const m = rows[0]?.m;
    return m == null ? null : Number(m);
  } catch {
    return null;
  }
}

export type WaitForSchemaOptions = {
  migrationsFolder: string;
  /** Give up after this long (default 60 s). */
  timeoutMs?: number;
  /** Poll period (default 250 ms). */
  intervalMs?: number;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onWaiting?: (applied: number | null, expected: number) => void;
  /** Return true to abandon the wait (shutdown); resolves without throwing. */
  isCancelled?: () => boolean;
};

/**
 * Block until another process has applied every migration in
 * `migrationsFolder`. Used by the non-migrating process (realm-reader) so it
 * never writes on an old schema.
 *
 * @throws SchemaNotCurrentError when the timeout elapses
 */
export async function waitForSchemaCurrent(
  db: Db,
  opts: WaitForSchemaOptions,
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 250;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const expected = expectedMigrationMillis(opts.migrationsFolder);
  const start = now();
  let warned = false;

  for (;;) {
    const applied = appliedMigrationMillis(db);
    if (applied != null && applied >= expected) return;
    if (opts.isCancelled?.()) return;
    const waited = now() - start;
    if (waited >= timeoutMs) {
      throw new SchemaNotCurrentError(expected, applied, waited);
    }
    if (!warned) {
      warned = true;
      opts.onWaiting?.(applied, expected);
    }
    await sleep(intervalMs);
  }
}
