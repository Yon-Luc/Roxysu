import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Elysia } from "elysia";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { bindDb } from "../db-runtime";
import { QUERY_MAX } from "../requestLimits";
import { collectionRoutes } from "./collections";

let db: Db;
let tmpDir: string;
let app: { handle: (req: Request) => Response | Promise<Response> };

async function request(
  pathname: string,
  init: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await app.handle(
    new Request(`http://localhost${pathname}`, {
      ...init,
      headers: { "content-type": "application/json" },
    }),
  );
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
  };
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-collections-limits-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  bindDb(db);
  app = new Elysia({ prefix: "/api" }).use(collectionRoutes);
});

afterAll(() => {
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("collection name/query bounds (M8 / L3)", () => {
  test("single create rejects an overlong name and query", async () => {
    const longName = await request("/api/collections/", {
      method: "POST",
      body: JSON.stringify({ name: "x".repeat(201), query: "mode:mania" }),
    });
    expect(longName.status).toBe(422);

    const longQuery = await request("/api/collections/", {
      method: "POST",
      body: JSON.stringify({
        name: "Long query",
        query: "a".repeat(QUERY_MAX + 1),
      }),
    });
    expect(longQuery.status).toBe(422);
  });

  test("single create trims and stores a bounded collection", async () => {
    const res = await request("/api/collections/", {
      method: "POST",
      body: JSON.stringify({ name: "  Practice  ", query: "  mode:mania  " }),
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Practice");
    expect(res.body.query).toBe("mode:mania");
  });

  test("batch create applies the same bounds per item", async () => {
    const longName = await request("/api/collections/batch", {
      method: "POST",
      body: JSON.stringify({
        items: [{ name: "x".repeat(201), query: "mode:mania" }],
      }),
    });
    expect(longName.status).toBe(422);

    const longQuery = await request("/api/collections/batch", {
      method: "POST",
      body: JSON.stringify({
        items: [{ name: "Bounded", query: "a".repeat(QUERY_MAX + 1) }],
      }),
    });
    expect(longQuery.status).toBe(422);
  });

  test("patch rejects an overlong name and query", async () => {
    const created = await request("/api/collections/", {
      method: "POST",
      body: JSON.stringify({ name: "Editable", query: "mode:mania" }),
    });
    expect(created.status).toBe(200);
    const id = created.body.id as number;

    const longName = await request(`/api/collections/${id}/`, {
      method: "PATCH",
      body: JSON.stringify({ name: "x".repeat(201) }),
    });
    expect(longName.status).toBe(422);

    const longQuery = await request(`/api/collections/${id}/`, {
      method: "PATCH",
      body: JSON.stringify({ query: "a".repeat(QUERY_MAX + 1) }),
    });
    expect(longQuery.status).toBe(422);

    const trimmed = await request(`/api/collections/${id}/`, {
      method: "PATCH",
      body: JSON.stringify({ name: "  Renamed  " }),
    });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.name).toBe("Renamed");
  });
});
