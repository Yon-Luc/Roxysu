import { Elysia } from "elysia";
import { ensureDb, type Db } from "@roxysu/db/client.bun";
import { defaultDbPath } from "./shared/db-path";

const dbPath = defaultDbPath();
export const db = ensureDb(dbPath);

export type { Db };

export const dbPlugin = new Elysia({ name: "db" }).decorate("db", db);

console.log(`[db] using ${dbPath}`);
