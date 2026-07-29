import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
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

export function createDb(dbPath: string) {
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const sqlite = new Database(dbPath, { timeout: BUSY_TIMEOUT_MS });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  sqlite.pragma("synchronous = NORMAL");
  // Server code uses Bun's `db.query()` API; better-sqlite3 uses `prepare()`.
  const withQuery = sqlite as typeof sqlite & {
    query: (sql: string) => ReturnType<typeof sqlite.prepare>;
  };
  withQuery.query = (sql: string) => sqlite.prepare(sql);
  return drizzle(withQuery, { schema }) as unknown as Db;
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
