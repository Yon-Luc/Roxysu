import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

/** Minimal raw SQLite surface used by server analytics / query-language. */
export type SqliteClient = {
  close(): void;
  query(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
};

/**
 * Runtime-neutral DB type shared by Bun and Node clients.
 * Result-type param is `any` so bun-sqlite (`void`) and better-sqlite3
 * (`RunResult`) both assign cleanly at the edges.
 */
export type Db = BaseSQLiteDatabase<"sync", any, typeof schema> & {
  $client: SqliteClient;
};
