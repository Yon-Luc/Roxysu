import { beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { Db } from "@roxysu/db/types";

import { bindDb } from "../db-runtime";
import { healthzBody, systemRoutes } from "./system";

const app = new Elysia().use(systemRoutes);

beforeAll(() => {
  // `dbPlugin` derives the DB for every request; healthz itself needs none.
  bindDb({} as Db);
});

describe("GET /system/healthz", () => {
  test("reports ok and the service marker the desktop waits for", async () => {
    const res = await app.handle(new Request("http://localhost/system/healthz"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("roxysu-server");
    expect(body.pid).toBe(process.pid);
  });

  test("echoes the per-launch instance token the desktop passed (DD-2)", () => {
    expect(healthzBody({ ROXYSU_INSTANCE_TOKEN: "abc-123" }).instance).toBe("abc-123");
  });

  test("instance is null for a standalone server", () => {
    expect(healthzBody({}).instance).toBeNull();
    expect(healthzBody({ ROXYSU_INSTANCE_TOKEN: "  " }).instance).toBeNull();
  });
});
