import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Database } from "bun:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "..", "drizzle");

export type Db = ReturnType<typeof createDb>;

export function createDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
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
