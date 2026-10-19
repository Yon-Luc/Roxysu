import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
  beatmapSets,
  beatmaps,
  bmsScoreDetails,
  closeDb,
  ensureDb,
  eq,
  mastery,
  scoreMetrics,
  scores,
  sessions,
} from "./client.bun";
import {
  findForeignKeyOrphans,
  foreignKeysEnabled,
  warnForeignKeyOrphans,
} from "./foreignKeys";
import type { Db } from "./types";

const NOW = new Date("2026-01-01T00:00:00Z");

function insertSet(db: Db, id: string) {
  db.insert(beatmapSets)
    .values({ id, onlineId: 1, dateAdded: NOW, status: 1 })
    .run();
}
function insertBeatmap(db: Db, id: string, setId: string) {
  db.insert(beatmaps)
    .values({
      id,
      onlineId: 1,
      setId,
      status: 1,
      length: 1,
      bpm: 120,
      starRating: 1,
    })
    .run();
}
function insertScore(db: Db, id: string, beatmapId: string | null) {
  db.insert(scores)
    .values({ id, onlineId: 1, legacyOnlineId: 1, beatmapId, playedAt: NOW })
    .run();
}

describe("mirror foreign keys", () => {
  let dir: string;
  let db: Db;
  const open: Db[] = [];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-fk-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
    open.push(db);
  });
  afterEach(() => {
    for (const d of open.splice(0)) closeDb(d);
    rmSync(dir, { recursive: true, force: true });
  });

  test("ensureDb returns a connection with foreign keys on", () => {
    expect(foreignKeysEnabled(db)).toBe(true);
    const reader = ensureDb(path.join(dir, "reader.sqlite"), { migrate: false });
    open.push(reader);
    expect(foreignKeysEnabled(reader)).toBe(true);
  });

  test("orphan inserts fail", () => {
    expect(() => insertBeatmap(db, "bm1", "missing-set")).toThrow();
    expect(() => insertScore(db, "s1", "missing-beatmap")).toThrow();
    expect(() =>
      db.insert(scoreMetrics).values({ scoreId: "missing-score" }).run(),
    ).toThrow();
    expect(() =>
      db
        .insert(mastery)
        .values({ beatmapId: "missing-beatmap", updatedAt: NOW })
        .run(),
    ).toThrow();
    expect(findForeignKeyOrphans(db)).toEqual([]);
  });

  test("a score with a null beatmap reference is allowed", () => {
    insertScore(db, "s1", null);
    expect(db.select().from(scores).all()).toHaveLength(1);
  });

  test("known delete flows work when children go first", () => {
    insertSet(db, "set1");
    insertBeatmap(db, "bm1", "set1");
    insertScore(db, "s1", "bm1");
    const session = db
      .insert(sessions)
      .values({ startedAt: NOW })
      .returning({ id: sessions.id })
      .get();
    db.insert(scoreMetrics)
      .values({ scoreId: "s1", sessionId: session.id })
      .run();
    db.insert(mastery).values({ beatmapId: "bm1", updatedAt: NOW }).run();

    // Parent first is rejected.
    expect(() => db.delete(scores).where(eq(scores.id, "s1")).run()).toThrow();
    expect(() => db.delete(beatmaps).where(eq(beatmaps.id, "bm1")).run()).toThrow();
    expect(() => db.delete(sessions).run()).toThrow();

    // Reconcile order: detach/delete children, then parents.
    db.update(scoreMetrics).set({ sessionId: null }).run();
    db.delete(sessions).run();
    db.delete(scoreMetrics).where(eq(scoreMetrics.scoreId, "s1")).run();
    db.delete(scores).where(eq(scores.id, "s1")).run();
    db.delete(mastery).where(eq(mastery.beatmapId, "bm1")).run();
    db.delete(beatmaps).where(eq(beatmaps.id, "bm1")).run();
    db.delete(beatmapSets).where(eq(beatmapSets.id, "set1")).run();
    expect(findForeignKeyOrphans(db)).toEqual([]);
  });

  test("deleting a score cascades to BMS score details", () => {
    insertScore(db, "s1", null);
    db.insert(bmsScoreDetails)
      .values({
        scoreId: "s1",
        normalizedScore: 0,
        accuracy: 0,
        variantId: "v",
        modAcronyms: "[]",
        updatedAt: NOW,
      })
      .run();
    db.delete(scores).where(eq(scores.id, "s1")).run();
    expect(db.select().from(bmsScoreDetails).all()).toHaveLength(0);
  });

  test("existing orphans are reported and tolerated on reopen", () => {
    const file = path.join(dir, "orphans.sqlite");
    const first = ensureDb(file);
    insertSet(first, "set1");
    insertBeatmap(first, "bm1", "set1");
    // Simulate a mirror written before foreign keys were enforced.
    first.run(sql`PRAGMA foreign_keys = OFF`);
    first.insert(scoreMetrics).values({ scoreId: "ghost" }).run();
    first.insert(mastery).values({ beatmapId: "ghost-bm", updatedAt: NOW }).run();
    closeDb(first);

    const warnings: string[] = [];
    const reopened = ensureDb(file, { migrate: false });
    open.push(reopened);
    expect(foreignKeysEnabled(reopened)).toBe(true);
    const groups = warnForeignKeyOrphans(reopened, (m) => warnings.push(m));
    expect(groups).toEqual(
      expect.arrayContaining([
        { table: "score_metrics", parent: "scores", count: 1 },
        { table: "mastery", parent: "beatmaps", count: 1 },
      ]),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("score_metrics -> scores: 1");

    // Orphans do not block unrelated writes.
    insertSet(reopened, "set2");
    insertBeatmap(reopened, "bm2", "set2");
    insertScore(reopened, "s2", "bm2");
  });

  test("a pending migration applies on a mirror that has orphan rows", () => {
    const file = path.join(dir, "migrate.sqlite");
    const first = ensureDb(file);
    first.run(sql`PRAGMA foreign_keys = OFF`);
    first.insert(scoreMetrics).values({ scoreId: "ghost" }).run();
    // Roll back the newest migration so ensureDb has something to apply.
    first.run(sql`ALTER TABLE beatmap_pattern_analysis DROP COLUMN shape_pattern`);
    first.run(
      sql`ALTER TABLE beatmap_pattern_analysis DROP COLUMN secondary_shape`,
    );
    first.run(
      sql`DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)`,
    );
    closeDb(first);

    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    let migrated: Db;
    try {
      migrated = ensureDb(file);
    } finally {
      console.warn = warn;
    }
    open.push(migrated);

    expect(foreignKeysEnabled(migrated)).toBe(true);
    const cols = migrated.all<{ name: string }>(
      sql`SELECT name FROM pragma_table_info('beatmap_pattern_analysis')`,
    );
    expect(cols.map((c) => c.name)).toContain("shape_pattern");
    expect(warnings.some((w) => w.includes("score_metrics -> scores"))).toBe(
      true,
    );
    expect(findForeignKeyOrphans(migrated)).toEqual([
      { table: "score_metrics", parent: "scores", count: 1 },
    ]);
  });
});
