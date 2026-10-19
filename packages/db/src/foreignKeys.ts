import { sql } from "drizzle-orm";
import type { Db } from "./types";

/** One group of foreign key violations (child rows whose parent is missing). */
export type ForeignKeyOrphanGroup = {
  /** Child table holding the dangling reference. */
  table: string;
  /** Parent table the reference points at. */
  parent: string;
  count: number;
};

/**
 * `PRAGMA foreign_keys` is per connection and a no-op inside a transaction, so
 * it must be set right after the connection opens (or after `migrate()`,
 * which runs inside one transaction).
 */
export function enableForeignKeys(db: Db) {
  db.run(sql`PRAGMA foreign_keys = ON`);
}

export function foreignKeysEnabled(db: Db): boolean {
  const rows = db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);
  return Number(rows[0]?.foreign_keys ?? 0) === 1;
}

/**
 * Existing orphans, grouped by child table and parent table. Orphans written
 * while foreign keys were off stay tolerated: SQLite only checks a child row
 * when its reference columns are written, so they never block unrelated writes.
 */
export function findForeignKeyOrphans(db: Db): ForeignKeyOrphanGroup[] {
  const rows = db.all<{ table: string; parent: string }>(
    sql`PRAGMA foreign_key_check`,
  );
  const groups = new Map<string, ForeignKeyOrphanGroup>();
  for (const row of rows) {
    const key = `${row.table}\u0000${row.parent}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { table: row.table, parent: row.parent, count: 1 });
  }
  return [...groups.values()];
}

/**
 * Boot-time audit: log a warning with counts per relationship. Never deletes
 * rows and never throws (a failed audit must not stop the process).
 */
export function warnForeignKeyOrphans(
  db: Db,
  warn: (message: string) => void = (m) => console.warn(m),
): ForeignKeyOrphanGroup[] {
  try {
    const groups = findForeignKeyOrphans(db);
    if (groups.length > 0) {
      const detail = groups
        .map((g) => `${g.table} -> ${g.parent}: ${g.count}`)
        .join(", ");
      warn(
        `[db] foreign_key_check found existing orphan rows (tolerated, not deleted): ${detail}`,
      );
    }
    return groups;
  } catch (err) {
    warn(
      `[db] foreign_key_check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}
