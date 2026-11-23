import { beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { Db } from "@roxysu/db/types";

import { bindDb } from "../db-runtime";
import { systemRoutes } from "./system";

const app = new Elysia().use(systemRoutes);

beforeAll(() => {
  // `dbPlugin` derives the DB for every request; healthz itself needs none.
  bindDb({} as Db);
});

describe("GET /system/healthz", () => {
  test("reports ok and the service marker the desktop waits for", async () => {
    const res = await app.handle(new Request("http://localhost/system/healthz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "roxysu-server" });
  });
});
