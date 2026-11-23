import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Elysia } from "elysia";
import { closeDb, ensureDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import { sessions } from "@roxysu/db/schema";
import { bindDb } from "../db-runtime";
import { sessionRoutes } from "./sessions";

let db: Db;
let tmpDir: string;
let app: { handle: (req: Request) => Response | Promise<Response> };

const SEED = 120;
/** UTC day every seeded session falls on. */
const DAY = "2026-11-01";

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-sessions-list-"));
  db = ensureDb(path.join(tmpDir, "test.sqlite"));
  bindDb(db);
  app = new Elysia({ prefix: "/api" }).use(sessionRoutes);

  // Newest seed first so item order assertions are unambiguous.
  const base = Date.UTC(2026, 10, 1, 12, 0, 0);
  const rows = Array.from({ length: SEED }, (_, i) => ({
    startedAt: new Date(base - i * 60_000),
    endedAt: new Date(base - i * 60_000 + 30_000),
    scoreCount: 3,
    rulesetShortName: "mania",
  }));
  db.insert(sessions).values(rows).run();
});

afterAll(() => {
  try {
    closeDb(db);
  } catch {
    // ignore
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

async function get(query: string) {
  const res = await app.handle(
    new Request(`http://localhost/api/sessions/${query}`),
  );
  return { status: res.status, body: (await res.json()) as any };
}

describe("GET /api/sessions list caps (S-NEW-1)", () => {
  test("no query returns the default cap, not every session", async () => {
    const { status, body } = await get("");
    expect(status).toBe(200);
    expect(body.items.length).toBe(100);
    expect(body.items.length).toBeLessThan(SEED);
  });

  test("?limit=5 returns 5", async () => {
    const { body } = await get("?limit=5");
    expect(body.items.length).toBe(5);
  });

  test("?limit=99999 clamps at the hard max and can exceed the default", async () => {
    const { body } = await get("?limit=99999");
    expect(body.items.length).toBe(SEED);
  });

  test("?day= respects the default cap", async () => {
    const { body } = await get(`?day=${DAY}`);
    expect(body.items.length).toBe(100);
  });

  test("?day= with an explicit limit respects it", async () => {
    const { body } = await get(`?day=${DAY}&limit=5`);
    expect(body.items.length).toBe(5);
  });

  test("items are newest first", async () => {
    const { body } = await get("?limit=3");
    const times: number[] = body.items.map((s: { startedAt: string }) =>
      new Date(s.startedAt).getTime(),
    );
    expect(times[0]).toBeGreaterThan(times[1]);
    expect(times[1]).toBeGreaterThan(times[2]);
  });
});
