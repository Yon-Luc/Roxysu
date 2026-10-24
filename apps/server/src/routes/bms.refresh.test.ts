import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import { BMS_TABLE_REFRESH_AT_KEY } from "@roxysu/db/settings-keys";
import type { Db } from "@roxysu/db/types";
import { Elysia } from "elysia";
import { bindDb } from "../db-runtime";
import { bmsRoutes, bmsTableRefreshInFlight } from "./bms";

let db: Db;
let tmpDir: string;
let refreshReads = 0;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-bms-refresh-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  const client = db.$client as unknown as {
    prepare: (sql: string) => {
      values: (...args: unknown[]) => unknown;
      all: (...args: unknown[]) => unknown;
      get: (...args: unknown[]) => unknown;
    };
  };
  const prepare = client.prepare.bind(client);
  client.prepare = (sql: string) => {
    const stmt = prepare(sql);
    if (!sql.includes("settings")) return stmt;
    const wrap = (method: "values" | "all" | "get") => {
      const fn = stmt[method].bind(stmt);
      stmt[method] = ((...args: unknown[]) => {
        if (args.includes(BMS_TABLE_REFRESH_AT_KEY)) {
          refreshReads += 1;
          throw new Error("SQLITE_BUSY");
        }
        return fn(...args);
      }) as typeof stmt[typeof method];
    };
    wrap("values");
    wrap("all");
    wrap("get");
    return stmt;
  };
  bindDb(db);
});

afterAll(() => {
  closeDb(db);
  rmSync(tmpDir, { recursive: true, force: true });
});

const app = new Elysia().use(bmsRoutes);

describe("GET /bms/tables refresh (G5)", () => {
  test("a throwing readSetting does not reject and a later GET can schedule again", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandled.push(err);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const first = await app.handle(new Request("http://localhost/bms/tables"));
      expect(first.status).toBe(200);
      const body = (await first.json()) as { tables: unknown[] };
      expect(body.tables.length).toBeGreaterThan(0);
      await bmsTableRefreshInFlight();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(bmsTableRefreshInFlight()).toBeNull();
      expect(refreshReads).toBe(1);

      const second = await app.handle(new Request("http://localhost/bms/tables"));
      expect(second.status).toBe(200);
      await bmsTableRefreshInFlight();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(bmsTableRefreshInFlight()).toBeNull();
      expect(refreshReads).toBe(2);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
