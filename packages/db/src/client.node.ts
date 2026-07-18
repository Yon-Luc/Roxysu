import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "..", "drizzle");

/** Wait this long for another process to release the write lock. */
const BUSY_TIMEOUT_MS = 30_000;

export type Db = ReturnType<typeof createDb>;

export function createDb(dbPath: string) {
  const sqlite = new Database(dbPath, { timeout: BUSY_TIMEOUT_MS });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sqlite.pragma("synchronous = NORMAL");
  return drizzle(sqlite, { schema });
}

/** Open SQLite and apply pending Drizzle migrations. */
export function ensureDb(dbPath: string) {
  const db = createDb(dbPath);
  migrate(db, { migrationsFolder });
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
