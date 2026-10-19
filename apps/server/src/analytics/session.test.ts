import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { closeDb } from "@roxysu/db/client.bun";
import { scoreMetrics, scores, sessions } from "@roxysu/db/schema";
import { runSessionEngine, tryRepairSessionDelta } from "./session";
import { createAnalyticsTestDb, seedScore } from "./analyticsTestDb";
import type { Db } from "../db-runtime";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.now();

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) closeDb(db);
});

function freshDb(): Db {
  const db = createAnalyticsTestDb();
  dbs.push(db);
  return db;
}

type Seed = { id: string; at: number };

function seed(db: Db, items: Seed[]): void {
  for (const item of items) {
    seedScore(db, { id: item.id, playedAt: item.at });
  }
}

type SessionShape = {
  startedAt: number;
  endedAt: number | null;
  scoreCount: number;
  scoreIds: string[];
};

/** Session ids and names differ between histories; compare the partition only. */
async function shape(db: Db): Promise<SessionShape[]> {
  const rows = await db.select().from(sessions);
  const metrics = await db.select().from(scoreMetrics);
  const out = rows.map((row) => ({
    startedAt: row.startedAt.getTime(),
    endedAt: row.endedAt?.getTime() ?? null,
    scoreCount: row.scoreCount,
    scoreIds: metrics
      .filter((m) => m.sessionId === row.id)
      .map((m) => m.scoreId)
      .sort(),
  }));
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Repair `delta` onto a DB that already holds `base`, and compare with a full
 * rebuild of base + delta. Asserts the delta path handled it (no fallback).
 */
async function expectDeltaMatchesFullRebuild(
  base: Seed[],
  delta: Seed[],
): Promise<void> {
  const repaired = freshDb();
  seed(repaired, base);
  await runSessionEngine(repaired);
  seed(repaired, delta);
  const result = await tryRepairSessionDelta(
    repaired,
    delta.map((d) => d.id),
  );
  expect(result).not.toBeNull();

  const rebuilt = freshDb();
  seed(rebuilt, [...base, ...delta]);
  await runSessionEngine(rebuilt);

  expect(await shape(repaired)).toEqual(await shape(rebuilt));

  const names = (await repaired.select().from(sessions)).map((s) => s.name);
  expect(names.every((n) => n != null && n !== "")).toBe(true);
  expect(new Set(names).size).toBe(names.length);
}

describe("tryRepairSessionDelta matches a full rebuild", () => {
  const recentBase: Seed[] = [
    { id: "old-1", at: NOW - 3 * HOUR },
    { id: "old-2", at: NOW - 3 * HOUR + 10 * MIN },
    { id: "open-1", at: NOW - 20 * MIN },
    { id: "open-2", at: NOW - 10 * MIN },
  ];

  test("appends to the open session", async () => {
    await expectDeltaMatchesFullRebuild(recentBase, [
      { id: "new-1", at: NOW - 2 * MIN },
    ]);
  });

  test("closes the open session and starts a new one after a gap", async () => {
    await expectDeltaMatchesFullRebuild(recentBase, [
      { id: "new-1", at: NOW + 60 * MIN },
    ]);
  });

  test("splits a batch with an inner gap into two sessions", async () => {
    await expectDeltaMatchesFullRebuild(recentBase, [
      { id: "new-1", at: NOW - 5 * MIN },
      { id: "new-2", at: NOW + 50 * MIN },
    ]);
  });

  test("handles scores older than the open session", async () => {
    await expectDeltaMatchesFullRebuild(recentBase, [
      { id: "older-1", at: NOW - 5 * HOUR },
      { id: "older-2", at: NOW - 5 * HOUR + 5 * MIN },
    ]);
  });

  test("handles scores that straddle the open session start", async () => {
    await expectDeltaMatchesFullRebuild(recentBase, [
      { id: "before-open", at: NOW - 45 * MIN },
      { id: "inside-open", at: NOW - 15 * MIN },
    ]);
  });

  test("extends a closed session", async () => {
    await expectDeltaMatchesFullRebuild(recentBase, [
      { id: "tail", at: NOW - 3 * HOUR + 35 * MIN },
    ]);
  });

  test("merges two closed sessions bridged by a new score", async () => {
    const base: Seed[] = [
      { id: "a-1", at: NOW - 10 * HOUR },
      { id: "a-2", at: NOW - 10 * HOUR + 10 * MIN },
      { id: "b-1", at: NOW - 10 * HOUR + 50 * MIN },
      { id: "b-2", at: NOW - 10 * HOUR + 60 * MIN },
      { id: "recent", at: NOW - 5 * MIN },
    ];
    await expectDeltaMatchesFullRebuild(base, [
      { id: "bridge", at: NOW - 10 * HOUR + 30 * MIN },
    ]);
  });

  test("opens a session when none is open", async () => {
    await expectDeltaMatchesFullRebuild(
      [
        { id: "old-1", at: NOW - 6 * HOUR },
        { id: "old-2", at: NOW - 6 * HOUR + 5 * MIN },
      ],
      [{ id: "new-1", at: NOW - 3 * MIN }],
    );
  });

  test("starts the first session on an empty timeline", async () => {
    await expectDeltaMatchesFullRebuild([], [{ id: "first", at: NOW - 1 * MIN }]);
  });

  test("re-extracted scores already attached to a session keep the partition", async () => {
    const db = freshDb();
    seed(db, recentBase);
    await runSessionEngine(db);
    const before = await shape(db);
    const result = await tryRepairSessionDelta(db, ["old-2", "open-2"]);
    expect(result).not.toBeNull();
    expect(await shape(db)).toEqual(before);
  });

  test("random timelines", async () => {
    let state = 12345;
    const rand = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    for (let round = 0; round < 25; round++) {
      const used = new Set<number>();
      const pick = (): number => {
        for (;;) {
          const at =
            NOW - Math.floor(rand() * 40) * 20 * MIN - Math.floor(rand() * 50) * MIN;
          if (!used.has(at)) {
            used.add(at);
            return at;
          }
        }
      };
      const base = Array.from({ length: 25 }, (_, i) => ({
        id: `r${round}-b${i}`,
        at: pick(),
      }));
      const delta = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => ({
        id: `r${round}-d${i}`,
        at: pick(),
      }));
      await expectDeltaMatchesFullRebuild(base, delta);
    }
  });
});

describe("tryRepairSessionDelta fallback", () => {
  test("returns null when scoped scores are not accounted for by sessions", async () => {
    const db = freshDb();
    seed(db, [
      { id: "a", at: NOW - 3 * HOUR },
      { id: "b", at: NOW - 3 * HOUR + 5 * MIN },
    ]);
    await runSessionEngine(db);
    // Never listed in the delta and never bucketed.
    seed(db, [{ id: "stray", at: NOW - 10 * HOUR }]);
    seed(db, [{ id: "new", at: NOW - 1 * MIN }]);

    expect(await tryRepairSessionDelta(db, ["new"])).toBeNull();

    // runSessionEngine then falls back to the full rebuild.
    await runSessionEngine(db, { scoreIds: ["new"] });
    const rebuilt = freshDb();
    seed(rebuilt, [
      { id: "a", at: NOW - 3 * HOUR },
      { id: "b", at: NOW - 3 * HOUR + 5 * MIN },
      { id: "stray", at: NOW - 10 * HOUR },
      { id: "new", at: NOW - 1 * MIN },
    ]);
    await runSessionEngine(rebuilt);
    expect(await shape(db)).toEqual(await shape(rebuilt));
  });

  test("returns no-op when the listed scores are out of scope", async () => {
    const db = freshDb();
    seed(db, [{ id: "a", at: NOW - 3 * HOUR }]);
    await runSessionEngine(db);
    await db.update(scores).set({ deletePending: true }).where(eq(scores.id, "a"));
    const result = await tryRepairSessionDelta(db, ["a"]);
    expect(result).toEqual({ started: [], finished: [] });
  });
});

describe("runSessionEngine full rebuild", () => {
  test("keeps session ids stable and nulls metrics of removed sessions", async () => {
    const db = freshDb();
    seed(db, [
      { id: "a-1", at: NOW - 10 * HOUR },
      { id: "a-2", at: NOW - 10 * HOUR + 5 * MIN },
      { id: "b-1", at: NOW - 5 * HOUR },
    ]);
    await runSessionEngine(db);
    const before = await db.select().from(sessions);
    expect(before).toHaveLength(2);
    const bId = (await db.select().from(scoreMetrics).where(eq(scoreMetrics.scoreId, "b-1")))[0]!
      .sessionId;

    await runSessionEngine(db);
    expect((await db.select().from(sessions)).map((s) => s.id).sort()).toEqual(
      before.map((s) => s.id).sort(),
    );

    // Session "a" loses every in-scope score; its metrics rows must not dangle.
    await db.update(scores).set({ deletePending: true }).where(eq(scores.id, "a-1"));
    await db.update(scores).set({ deletePending: true }).where(eq(scores.id, "a-2"));
    await runSessionEngine(db);

    const after = await db.select().from(sessions);
    expect(after.map((s) => s.id)).toEqual([bId!]);
    const metrics = await db.select().from(scoreMetrics);
    expect(metrics.filter((m) => m.scoreId.startsWith("a-")).every((m) => m.sessionId == null)).toBe(
      true,
    );
  });

  test("clears every session when no scores remain in scope", async () => {
    const db = freshDb();
    seed(db, [{ id: "a", at: NOW - 3 * HOUR }]);
    await runSessionEngine(db);
    await db.update(scores).set({ deletePending: true });
    await runSessionEngine(db);
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect((await db.select().from(scoreMetrics))[0]?.sessionId ?? null).toBeNull();
  });
});
