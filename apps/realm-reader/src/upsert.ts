import {
  beatmapSets,
  beatmaps,
  getTableColumns,
  rulesets,
  scores,
  sql,
  type Db,
} from "@roxysu/db/client.node";

export const BATCH_SIZE = 500;

export type UpsertResult = {
  attempted: number;
  changed: number;
};

function isSqliteBusy(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return lower.includes("database is locked") || lower.includes("sqlite_busy");
}

/** Sync sleep for busy-retry backoff (better-sqlite3 is synchronous). */
function sleepSync(ms: number) {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

const BUSY_RETRIES = 8;

export function withBusyRetry<T>(fn: () => T): T {
  let lastErr: unknown;
  for (let attempt = 0; attempt < BUSY_RETRIES; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (!isSqliteBusy(err) || attempt === BUSY_RETRIES - 1) throw err;
      const delay =
        Math.min(2_000, 50 * 2 ** attempt) + Math.floor(Math.random() * 50);
      sleepSync(delay);
    }
  }
  throw lastErr;
}

/** Build onConflictDoUpdate `set` for every column except the primary key(s). */
function conflictSet(
  table: Parameters<typeof getTableColumns>[0],
  primaryKeyNames: string[],
): Record<string, ReturnType<typeof sql.raw>> {
  const columns = getTableColumns(table);
  const set: Record<string, ReturnType<typeof sql.raw>> = {};
  for (const [name, col] of Object.entries(columns)) {
    if (primaryKeyNames.includes(name)) continue;
    set[name] = sql.raw(`excluded.\`${col.name}\``);
  }
  return set;
}

export function sqliteTableName(
  table: typeof rulesets | typeof beatmapSets | typeof beatmaps | typeof scores,
): string {
  if (table === rulesets) return "rulesets";
  if (table === beatmapSets) return "beatmap_sets";
  if (table === beatmaps) return "beatmaps";
  return "scores";
}

/** Only apply conflict updates when at least one non-PK column differs. */
function conflictSetWhere(
  table: typeof rulesets | typeof beatmapSets | typeof beatmaps | typeof scores,
  primaryKeyNames: string[],
) {
  const columns = getTableColumns(table);
  const resolvedName = sqliteTableName(table);

  const parts: ReturnType<typeof sql>[] = [];
  for (const [name, col] of Object.entries(columns)) {
    if (primaryKeyNames.includes(name)) continue;
    parts.push(
      sql.raw(
        `excluded.\`${col.name}\` IS DISTINCT FROM \`${resolvedName}\`.\`${col.name}\``,
      ),
    );
  }
  if (parts.length === 0) return undefined;
  return sql.join(parts, sql` OR `);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function upsertBatches(
  db: Db,
  table: typeof rulesets | typeof beatmapSets | typeof beatmaps | typeof scores,
  rows: Record<string, unknown>[],
  primaryKeyNames: string[],
): UpsertResult {
  if (rows.length === 0) return { attempted: 0, changed: 0 };
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  const targetCols = primaryKeyNames.map((k) => {
    const col = columns[k];
    if (!col) throw new Error(`unknown primary key column: ${k}`);
    return col;
  });
  const target = targetCols.length === 1 ? targetCols[0]! : targetCols;
  const set = conflictSet(table, primaryKeyNames);
  const setWhere = conflictSetWhere(table, primaryKeyNames);

  let changed = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const result = withBusyRetry(() =>
      db
        .insert(table)
        .values(batch as never[])
        .onConflictDoUpdate({
          target: target as never,
          set: set as never,
          ...(setWhere ? { setWhere } : {}),
        })
        .run(),
    );
    changed += result.changes;
  }
  return { attempted: rows.length, changed };
}

/**
 * Map source objects one at a time and upsert in bounded batches, so peak
 * heap stays flat regardless of library size (never materializes all rows).
 * Lives apart from sync.ts so it can be tested without the Realm native addon.
 */
export function streamMappedUpsert(
  db: Db,
  table: typeof rulesets | typeof beatmapSets | typeof beatmaps | typeof scores,
  objects: Iterable<unknown>,
  mapRow: (obj: unknown) => Record<string, unknown> | null,
  primaryKeyNames: string[],
  onRow?: (row: Record<string, unknown>) => void,
): UpsertResult {
  let buffer: Record<string, unknown>[] = [];
  let attempted = 0;
  let changed = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    const result = upsertBatches(db, table, buffer, primaryKeyNames);
    attempted += result.attempted;
    changed += result.changed;
    buffer = [];
  };

  for (const obj of objects) {
    const row = mapRow(obj);
    if (!row) continue;
    onRow?.(row);
    buffer.push(row);
    if (buffer.length >= BATCH_SIZE) flush();
  }
  flush();

  return { attempted, changed };
}
