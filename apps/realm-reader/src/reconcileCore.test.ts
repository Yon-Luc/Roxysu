import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapSets,
  beatmaps,
  closeDb,
  count,
  ensureDb,
  scores,
  type Db,
} from "@roxysu/db/client.bun";
import {
  CATCHUP_STALL_LIMIT,
  NO_CATCH_UP,
  finishCountGapRound,
  readStallCount,
  startCountGapRound,
  writeStallCount,
  type CatchUpResult,
  type RealmCounts,
  type RealmIdSets,
} from "./reconcileCore";
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

describe("reconcile count-gap round (F-001)", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-reconcile-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  const n = (table: typeof scores | typeof beatmaps | typeof beatmapSets) =>
    db.select({ n: count() }).from(table).get()?.n ?? 0;

  /**
   * Mirror holds sets 1..2, beatmaps 1..2 and scores 1..3. Realm keeps only
   * score 1 plus (optionally) a Realm-only score that can never mirror.
   */
  function seedMirror() {
    const seed = new FakeRealm();
    seed.addSet(fakeSet(1));
    seed.addSet(fakeSet(2));
    seed.addBeatmap(fakeBeatmap(1, 1));
    seed.addBeatmap(fakeBeatmap(2, 2));
    seed.addScore(fakeScore(1, 1));
    seed.addScore(fakeScore(2, 1));
    seed.addScore(fakeScore(3, 2));
    const w = new DeltaWriter(db, seed, NO_WATERMARK);
    w.writeSets([...seed.sets.values()].map((o) => mapBeatmapSet(o as never)!));
    w.writeBeatmaps(
      [...seed.beatmaps.values()].map((o) => mapBeatmap(o as never)!),
    );
    w.writeScores([...seed.scores.values()].map((o) => mapScore(o as never)!));
  }

  /** Realm after scores 2 and 3 plus map 2 / set 2 were deleted, + `ghosts` unmirrorable scores. */
  function realmIds(ghosts: number): { ids: RealmIdSets; counts: RealmCounts } {
    const ids: RealmIdSets = {
      realmScoreIds: new Set([scoreId(1)]),
      realmBeatmapIds: new Set([beatmapId(1)]),
      realmSetIds: new Set([setId(1)]),
    };
    for (let i = 0; i < ghosts; i++) ids.realmScoreIds.add(scoreId(500 + i));
    return {
      ids,
      counts: { scores: ids.realmScoreIds.size, beatmaps: 1, sets: 1 },
    };
  }

  const noCatchUp = (): CatchUpResult => NO_CATCH_UP;

  function runRound(
    realm: ReturnType<typeof realmIds>,
    catchUp: (ids: RealmIdSets) => CatchUpResult = noCatchUp,
  ) {
    let catchUpCalls = 0;
    const round = startCountGapRound(db, realm.counts, {
      collectRealmIdSets: () => realm.ids,
      catchUp: (ids) => {
        catchUpCalls += 1;
        return catchUp(ids);
      },
    });
    const deleted = db.transaction((tx) =>
      finishCountGapRound(tx as never, round, realm.counts),
    );
    return { round, deleted, catchUpCalls: () => catchUpCalls };
  }

  test("a tripped stall breaker still deletes orphans and skips only catch-up", () => {
    seedMirror();
    writeStallCount(db as never, CATCHUP_STALL_LIMIT);
    // 1 unmirrorable Realm score keeps the gap open: realm scores = 2, mirror = 1 after deletes.
    const realm = realmIds(1);

    const { round, deleted, catchUpCalls } = runRound(realm);

    expect(round.stalled).toBe(true);
    expect(catchUpCalls()).toBe(0);
    expect(deleted.scoresDeleted).toBe(2);
    expect(deleted.beatmapsDeleted).toBe(1);
    expect(deleted.beatmapSetsDeleted).toBe(1);
    expect(n(scores)).toBe(1);
    expect(n(beatmaps)).toBe(1);
    expect(n(beatmapSets)).toBe(1);
  });

  test("deletes while stalled do not re-arm the stall counter", () => {
    seedMirror();
    writeStallCount(db as never, CATCHUP_STALL_LIMIT);
    const realm = realmIds(1); // gap stays open after the deletes

    const { deleted } = runRound(realm);

    expect(deleted.scoresDeleted).toBeGreaterThan(0);
    expect(readStallCount(db as never)).toBe(CATCHUP_STALL_LIMIT);

    // Next reconcile is stalled again and does no catch-up.
    const again = runRound(realm);
    expect(again.round.stalled).toBe(true);
    expect(again.catchUpCalls()).toBe(0);
    expect(readStallCount(db as never)).toBe(CATCHUP_STALL_LIMIT);
  });

  test("a stalled round whose deletes close the gap resets the breaker", () => {
    seedMirror();
    writeStallCount(db as never, CATCHUP_STALL_LIMIT);
    runRound(realmIds(0)); // counts now equal
    expect(readStallCount(db as never)).toBe(0);
  });

  test("a non-stalled round where only deletes moved rows counts as fruitless", () => {
    seedMirror();
    writeStallCount(db as never, 1);
    const { deleted, catchUpCalls } = runRound(realmIds(1));
    expect(catchUpCalls()).toBe(1);
    expect(deleted.scoresDeleted).toBe(2);
    expect(readStallCount(db as never)).toBe(2);
  });

  test("a catch-up that moves rows resets the breaker even if the gap stays open", () => {
    seedMirror();
    writeStallCount(db as never, 2);
    runRound(realmIds(2), () => ({ ...NO_CATCH_UP, rowsChanged: 1 }));
    expect(readStallCount(db as never)).toBe(0);
  });

  test("matching counts do no id scan, catch-up or deletes", () => {
    seedMirror();
    let collected = 0;
    const round = startCountGapRound(
      db,
      { scores: 3, beatmaps: 2, sets: 2 },
      {
        collectRealmIdSets: () => {
          collected += 1;
          return realmIds(0).ids;
        },
        catchUp: () => NO_CATCH_UP,
      },
    );
    expect(round.ids).toBeNull();
    expect(collected).toBe(0);
    expect(
      db.transaction((tx) =>
        finishCountGapRound(tx as never, round, { scores: 3, beatmaps: 2, sets: 2 }),
      ).scoresDeleted,
    ).toBe(0);
    expect(n(scores)).toBe(3);
  });
});
