import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapDanRatingVariants,
  beatmapSets,
  beatmaps,
  closeDb,
  count,
  ensureDb,
  findForeignKeyOrphans,
  foreignKeysEnabled,
  mastery,
  playSessions,
  scoreMetrics,
  scores,
  sessions,
  type Db,
} from "@roxysu/db/client.bun";
import { reconcileDeletes } from "./reconcileCore";
import { DeltaWriter } from "./deltaCore";
import { mapBeatmap, mapBeatmapSet, mapScore } from "./map";
import {
  FakeRealm,
  beatmapId,
  fakeBeatmap,
  fakeScore,
  fakeSet,
  scoreId,
  setId,
} from "./testFixtures";

const NO_WATERMARK = { maxPlayedAt: null, maxLastLocalUpdate: null };

describe("reconcile deletes with foreign keys enforced (F-012)", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-reconcile-fk-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });
  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  const n = (table: typeof scores | typeof beatmaps | typeof beatmapSets) =>
    db.select({ n: count() }).from(table).get()?.n ?? 0;

  function seedMirrorWithDerivedRows() {
    const seed = new FakeRealm();
    seed.addSet(fakeSet(1));
    seed.addSet(fakeSet(2));
    seed.addBeatmap(fakeBeatmap(1, 1));
    seed.addBeatmap(fakeBeatmap(2, 2));
    seed.addScore(fakeScore(1, 1));
    seed.addScore(fakeScore(2, 2));
    const w = new DeltaWriter(db, seed, NO_WATERMARK);
    w.writeSets([...seed.sets.values()].map((o) => mapBeatmapSet(o as never)!));
    w.writeBeatmaps(
      [...seed.beatmaps.values()].map((o) => mapBeatmap(o as never)!),
    );
    w.writeScores([...seed.scores.values()].map((o) => mapScore(o as never)!));

    const now = new Date();
    const session = db
      .insert(sessions)
      .values({ startedAt: now })
      .returning({ id: sessions.id })
      .get();
    db.insert(scoreMetrics)
      .values({ scoreId: scoreId(2), sessionId: session.id })
      .run();
    db.insert(mastery)
      .values({ beatmapId: beatmapId(2), updatedAt: now })
      .run();
    db.insert(beatmapDanRatingVariants)
      .values({
        beatmapId: beatmapId(2),
        algorithm: "daniel",
        rate: 1,
        lnOnly: false,
        updatedAt: now,
      })
      .run();
    db.insert(playSessions)
      .values({
        id: "play-1",
        beatmapId: beatmapId(2),
        totalScore: 1,
        accuracy: 1,
        maxCombo: 1,
      })
      .run();
  }

  test("deleting a beatmap, its set and score removes every child row first", () => {
    expect(foreignKeysEnabled(db)).toBe(true);
    seedMirrorWithDerivedRows();

    const deleted = reconcileDeletes(
      db,
      new Set([scoreId(1)]),
      new Set([beatmapId(1)]),
      new Set([setId(1)]),
    );

    expect(deleted.scoresDeleted).toBe(1);
    expect(deleted.beatmapsDeleted).toBe(1);
    expect(deleted.beatmapSetsDeleted).toBe(1);
    expect(n(scores)).toBe(1);
    expect(n(beatmaps)).toBe(1);
    expect(n(beatmapSets)).toBe(1);
    expect(db.select({ n: count() }).from(playSessions).get()?.n).toBe(0);
    expect(findForeignKeyOrphans(db)).toEqual([]);
  });

  test("a set still referenced by a surviving beatmap is kept", () => {
    seedMirrorWithDerivedRows();

    const deleted = reconcileDeletes(
      db,
      new Set([scoreId(1), scoreId(2)]),
      new Set([beatmapId(1), beatmapId(2)]),
      new Set([setId(1)]), // set 2 vanished but beatmap 2 is still in Realm
    );

    expect(deleted.beatmapSetsDeleted).toBe(0);
    expect(n(beatmapSets)).toBe(2);
    expect(findForeignKeyOrphans(db)).toEqual([]);
  });
});
