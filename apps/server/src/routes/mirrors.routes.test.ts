import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, closeDb } from "@roxysu/db/client.bun";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { beatmapSets } from "@roxysu/db/schema";
import { Elysia } from "elysia";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bindDb, type Db } from "../db-runtime";
import { MAX_OWNERSHIP_DIFF_IDS } from "../mirrors/ownership";
import { getMirrorBatchJobState } from "../mirrors";
import { mirrorRoutes } from "./mirrors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "db",
  "drizzle",
);

let db: Db;
const app = new Elysia().use(mirrorRoutes);

beforeAll(() => {
  db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
  bindDb(db);
  db.insert(beatmapSets)
    .values(
      [10, 20, 30].map((onlineId) => ({
        id: `set-${onlineId}`,
        onlineId,
        dateAdded: new Date(),
        status: 1,
        deletePending: false,
      })),
    )
    .run();
});

afterAll(() => {
  closeDb(db);
});

const get = (url: string, headers?: Record<string, string>) =>
  app.handle(new Request(`http://localhost${url}`, { headers }));

describe("POST /mirrors/batch/start setIds cap (F-055)", () => {
  test("rejects more than MAX_OWNERSHIP_DIFF_IDS ids with 400 before starting a job", async () => {
    const setIds = Array.from({ length: MAX_OWNERSHIP_DIFF_IDS + 1 }, (_, i) => i + 1);
    const res = await app.handle(
      new Request("http://localhost/mirrors/batch/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "setIds", setIds }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("limited to");
    expect(getMirrorBatchJobState().status).toBe("idle");
  });
});

describe("GET /mirrors/owned-set-ids (F-054)", () => {
  test("returns a bounded page with nextAfter and a version", async () => {
    const res = await get("/mirrors/owned-set-ids?limit=2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      setIds: number[];
      nextAfter: number | null;
      version: string;
    };
    expect(body.setIds).toEqual([10, 20]);
    expect(body.nextAfter).toBe(20);
    expect(typeof body.version).toBe("string");

    const res2 = await get(`/mirrors/owned-set-ids?limit=2&after=${body.nextAfter}`);
    const body2 = (await res2.json()) as { setIds: number[]; nextAfter: number | null };
    expect(body2.setIds).toEqual([30]);
    expect(body2.nextAfter).toBeNull();
  });

  test("no query params still returns every owned id when under the default cap", async () => {
    const res = await get("/mirrors/owned-set-ids");
    const body = (await res.json()) as { setIds: number[]; nextAfter: number | null };
    expect(body.setIds).toEqual([10, 20, 30]);
    expect(body.nextAfter).toBeNull();
  });

  test("honors If-None-Match with 304 so clients skip the re-download", async () => {
    const first = await get("/mirrors/owned-set-ids?limit=2");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const second = await get("/mirrors/owned-set-ids?limit=2", {
      "if-none-match": etag!,
    });
    expect(second.status).toBe(304);
  });
});
