import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "..", "drizzle");

/** Wait this long for another process to release the write lock. */
const BUSY_TIMEOUT_MS = 30_000;

export type { Db } from "./types";
import type { Db } from "./types";

export function createDb(dbPath: string): Db {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  sqlite.exec("PRAGMA synchronous = NORMAL;");
  return drizzle(sqlite, { schema }) as unknown as Db;
}

/** Open SQLite and apply pending Drizzle migrations. */
export function ensureDb(dbPath: string) {
  const db = createDb(dbPath);
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
  return db;
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
export { failStaleRunningImports } from "./failStaleRunningImports";
