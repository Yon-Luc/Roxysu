import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Elysia } from "elysia";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { bindDb } from "../db-runtime";
import {
  getCachedPlayerStats,
  setCachedPlayerStats,
} from "../analytics/playerStatsCache";
import { settingsRoutes } from "./settings";

let db: Db;
let tmpDir: string;
let app: { handle: (req: Request) => Response | Promise<Response> };

async function patch(body: unknown): Promise<Response> {
  return await app.handle(
    new Request("http://localhost/api/settings/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-settings-stats-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  bindDb(db);
  app = new Elysia({ prefix: "/api" }).use(settingsRoutes);
});

afterAll(() => {
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("PATCH /settings customize changes and the player stats cache", () => {
  test("changing axis thresholds drops cached /stats payloads", async () => {
    setCachedPlayerStats("k-axis", { bands: "old" });
    expect(getCachedPlayerStats("k-axis")).not.toBeNull();

    const res = await patch({ lnRatioThreshold: 0.21, flnRatioThreshold: 0.83 });
    expect(res.status).toBe(200);
    expect(getCachedPlayerStats("k-axis")).toBeNull();
  });

  test("an unchanged threshold payload keeps the cache", async () => {
    await patch({ lnRatioThreshold: 0.21, flnRatioThreshold: 0.83 });
    setCachedPlayerStats("k-same", { bands: "same" });

    const res = await patch({ lnRatioThreshold: 0.21, flnRatioThreshold: 0.83 });
    expect(res.status).toBe(200);
    expect(getCachedPlayerStats("k-same")).not.toBeNull();
  });
});
