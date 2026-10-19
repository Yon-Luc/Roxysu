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
  /** Rows dropped after a constraint error so the rest of the batch can commit. */
  skipped: number;
  /** Primary-key keys (`id=…`) for rows skipped by constraint bisect. */
  skippedKeys: string[];
};

function sqliteErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "";
}

function sqliteErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isSqliteBusy(err: unknown): boolean {
  const code = sqliteErrorCode(err);
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;
  const lower = sqliteErrorMessage(err).toLowerCase();
  return lower.includes("database is locked") || lower.includes("sqlite_busy");
}

/** NOT NULL, foreign key, and other constraints. Busy/locked is not one of these. */
function isSqliteConstraint(err: unknown): boolean {
  const code = sqliteErrorCode(err);
  if (code.startsWith("SQLITE_CONSTRAINT")) return true;
  return sqliteErrorMessage(err).toLowerCase().includes("constraint failed");
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

export function sqliteTableName(table: UpsertTable): string {
  if (table === rulesets) return "rulesets";
  if (table === beatmapSets) return "beatmap_sets";
  if (table === beatmaps) return "beatmaps";
  return "scores";
}

/** Only apply conflict updates when at least one non-PK column differs. */
function conflictSetWhere(table: UpsertTable, primaryKeyNames: string[]) {
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

type UpsertTable =
  | typeof rulesets
  | typeof beatmapSets
  | typeof beatmaps
  | typeof scores;

function rowPrimaryKey(
  row: Record<string, unknown>,
  primaryKeyNames: string[],
): string {
  return primaryKeyNames.map((name) => `${name}=${String(row[name])}`).join(" ");
}

/**
 * Insert one batch. A constraint failure is bisected until the bad row is
 * alone, then that row is skipped. The failed statement rolls back, so the
 * halves are inserted cleanly. Busy errors still retry and are never skipped.
 */
function upsertChunk(
  db: Db,
  table: UpsertTable,
  rows: Record<string, unknown>[],
  primaryKeyNames: string[],
  target: unknown,
  set: unknown,
  setWhere: ReturnType<typeof conflictSetWhere>,
): { changed: number; skipped: number; skippedKeys: string[] } {
  try {
    const result = withBusyRetry(() =>
      db
        .insert(table)
        .values(rows as never[])
        .onConflictDoUpdate({
          target: target as never,
          set: set as never,
          ...(setWhere ? { setWhere } : {}),
        })
        .run(),
    );
    return { changed: result.changes, skipped: 0, skippedKeys: [] };
  } catch (err) {
    if (!isSqliteConstraint(err)) throw err;
    if (rows.length <= 1) {
      const key = rows[0]
        ? rowPrimaryKey(rows[0], primaryKeyNames)
        : "(empty)";
      console.warn(
        `skip ${sqliteTableName(table)} ${key}: ${sqliteErrorMessage(err)}`,
      );
      return {
        changed: 0,
        skipped: rows.length,
        skippedKeys: rows[0] ? [key] : [],
      };
    }
    const mid = Math.floor(rows.length / 2);
    const left = upsertChunk(
      db,
      table,
      rows.slice(0, mid),
      primaryKeyNames,
      target,
      set,
      setWhere,
    );
    const right = upsertChunk(
      db,
      table,
      rows.slice(mid),
      primaryKeyNames,
      target,
      set,
      setWhere,
    );
    return {
      changed: left.changed + right.changed,
      skipped: left.skipped + right.skipped,
      skippedKeys: [...left.skippedKeys, ...right.skippedKeys],
    };
  }
}

export function upsertBatches(
  db: Db,
  table: UpsertTable,
  rows: Record<string, unknown>[],
  primaryKeyNames: string[],
  onBatch?: () => void,
): UpsertResult {
  if (rows.length === 0) {
    return { attempted: 0, changed: 0, skipped: 0, skippedKeys: [] };
  }
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
  let skipped = 0;
  const skippedKeys: string[] = [];
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const result = upsertChunk(
      db,
      table,
      batch,
      primaryKeyNames,
      target,
      set,
      setWhere,
    );
    onBatch?.();
    changed += result.changed;
    skipped += result.skipped;
    skippedKeys.push(...result.skippedKeys);
  }
  return { attempted: rows.length, changed, skipped, skippedKeys };
}

/**
 * Map source objects one at a time and upsert in bounded batches, so peak
 * heap stays flat regardless of library size (never materializes all rows).
 * Lives apart from sync.ts so it can be tested without the Realm native addon.
 *
 * `onUpserted` runs only for rows that committed (not constraint-skipped), so
 * watermarks must not advance from rows that never landed in the local mirror.
 */
export function streamMappedUpsert(
  db: Db,
  table: UpsertTable,
  objects: Iterable<unknown>,
  mapRow: (obj: unknown) => Record<string, unknown> | null,
  primaryKeyNames: string[],
  onUpserted?: (row: Record<string, unknown>) => void,
  onBatch?: () => void,
): UpsertResult {
  let buffer: Record<string, unknown>[] = [];
  let attempted = 0;
  let changed = 0;
  let skipped = 0;
  const skippedKeys: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    const result = upsertBatches(db, table, batch, primaryKeyNames, onBatch);
    attempted += result.attempted;
    changed += result.changed;
    skipped += result.skipped;
    skippedKeys.push(...result.skippedKeys);
    if (onUpserted) {
      const skippedSet = new Set(result.skippedKeys);
      for (const row of batch) {
        if (!skippedSet.has(rowPrimaryKey(row, primaryKeyNames))) {
          onUpserted(row);
        }
      }
    }
  };

  for (const obj of objects) {
    const row = mapRow(obj);
    if (!row) continue;
    buffer.push(row);
    if (buffer.length >= BATCH_SIZE) flush();
  }
  flush();

  return { attempted, changed, skipped, skippedKeys };
}
