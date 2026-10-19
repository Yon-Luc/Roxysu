import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";
import { enableForeignKeys, warnForeignKeyOrphans } from "./foreignKeys";
import {
  skipMigrateFromEnv,
  waitForSchemaCurrent,
  type WaitForSchemaOptions,
} from "./schemaVersion";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "..", "drizzle");

/** Wait this long for another process to release the write lock. */
const BUSY_TIMEOUT_MS = 30_000;

export type { Db } from "./types";
import type { Db } from "./types";

export type CreateDbOptions = {
  /**
   * Enforce foreign keys on this connection (default true). `ensureDb` opens
   * with false while migrating and turns it on afterwards.
   */
  foreignKeys?: boolean;
};

export function createDb(dbPath: string, opts: CreateDbOptions = {}): Db {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  sqlite.exec(
    `PRAGMA foreign_keys = ${opts.foreignKeys === false ? "OFF" : "ON"};`,
  );
  return drizzle(sqlite, { schema }) as unknown as Db;
}

export type EnsureDbOptions = {
  /**
   * Apply pending Drizzle migrations (default true unless `ROXYSU_SKIP_MIGRATE`
   * is set). Exactly one process (apps/server) migrates; the realm-reader
   * passes `false` and calls `waitForSchema` instead.
   */
  migrate?: boolean;
};

/**
 * Open SQLite; apply pending Drizzle migrations unless `migrate` is false.
 *
 * Foreign keys are enforced on the returned connection. A migrating connection
 * opens with them OFF and enables them after `migrate()`: the migrator runs in
 * one transaction, where `PRAGMA foreign_keys` is a no-op, so a table-recreate
 * migration (drop + rename) could otherwise fail or cascade on existing rows.
 * Existing orphan rows are reported once (warning) and tolerated.
 */
export function ensureDb(dbPath: string, opts: EnsureDbOptions = {}) {
  const shouldMigrate = opts.migrate ?? !skipMigrateFromEnv();
  const db = createDb(dbPath, { foreignKeys: !shouldMigrate });
  if (shouldMigrate) {
    migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
    enableForeignKeys(db);
  }
  warnForeignKeyOrphans(db);
  return db;
}

/** Wait (bounded) until another process has migrated this file. */
export function waitForSchema(
  db: Db,
  opts: Omit<WaitForSchemaOptions, "migrationsFolder"> = {},
) {
  return waitForSchemaCurrent(db, { ...opts, migrationsFolder });
}

export function closeDb(db: Db) {
  db.$client.close();
}

export {
  eq,
  sql,
  getTableColumns,
  max,
  and,
  desc,
  inArray,
  gt,
  count,
  asc,
  ne,
  or,
  like,
  gte,
  lte,
  isNull,
  isNotNull,
  not,
  avg,
  sum,
  min,
} from "drizzle-orm";
export * from "./schema";
export { clearStuckRealmReaderPause } from "./clearStuckRealmReaderPause";
export {
  failStaleRunningImports,
  failStaleRunningImportsOlderThan,
  STALE_RUNNING_MS,
} from "./failStaleRunningImports";
export { SchemaNotCurrentError } from "./schemaVersion";
export {
  enableForeignKeys,
  findForeignKeyOrphans,
  foreignKeysEnabled,
  warnForeignKeyOrphans,
  type ForeignKeyOrphanGroup,
} from "./foreignKeys";
