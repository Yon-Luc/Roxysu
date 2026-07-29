import { Elysia } from "elysia";
import type { Db } from "@roxysu/db/types";

let boundDb: Db | null = null;

/** Bind the process DB before mounting routes (Bun or Node entry). */
export function bindDb(db: Db): void {
  boundDb = db;
}

export function getDb(): Db {
  if (!boundDb) {
    throw new Error("DB not bound — call bindDb() from the process entrypoint");
  }
  return boundDb;
}

export type { Db };

/** Runtime-neutral plugin; resolves DB at request time after bindDb(). */
export const dbPlugin = new Elysia({ name: "db" }).derive(
  { as: "global" },
  () => ({ db: getDb() }),
);
