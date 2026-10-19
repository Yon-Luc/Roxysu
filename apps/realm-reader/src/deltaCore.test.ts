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
  eq,
  scores,
  type Db,
} from "@roxysu/db/client.bun";
import {
  CappedIdSet,
  DeltaWriter,
  healFlaggedRows,
  streamIncrementalDelta,
  symmetricDifference,
} from "./deltaCore";
import { FULL_ANALYTICS_ID_THRESHOLD } from "./importJournal";
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
const OLD = new Date(2025, 0, 1);

describe("deltaCore", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-delta-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  const countOf = (table: typeof scores | typeof beatmaps | typeof beatmapSets) =>
    db.select({ n: count() }).from(table).get()?.n ?? 0;

  describe("symmetricDifference", () => {
    test("is order-independent and ignores shared ids", () => {
      expect(
        symmetricDifference(["a", "b", "c"], ["c", "d", "a"]).sort(),
      ).toEqual(["b", "d"]);
      expect(symmetricDifference(["a", "b"], ["b", "a"])).toEqual([]);
    });
  });

  describe("CappedIdSet", () => {
    test("reports null once more ids than the analytics threshold are added", () => {
      const ids = new CappedIdSet();
      for (let i = 0; i < FULL_ANALYTICS_ID_THRESHOLD; i++) ids.add(`id-${i}`);
      expect(ids.toList()?.length).toBe(FULL_ANALYTICS_ID_THRESHOLD);
      ids.add("one-too-many");
      expect(ids.toList()).toBeNull();
    });
  });

  describe("flag healing compares id sets (F-010)", () => {
    test("equal soft-delete counts but different ids still heal both rows", () => {
      const realm = new FakeRealm();
      realm.addSet(fakeSet(1));
      realm.addBeatmap(fakeBeatmap(1, 1, { LastLocalUpdate: OLD }));
      // Realm now: score 1 restored (not pending), score 2 newly pending.
      realm.addScore(fakeScore(1, 1, { DeletePending: false, Date: OLD }));
      realm.addScore(fakeScore(2, 1, { DeletePending: true, Date: OLD }));

      // Local mirror still has the previous state: score 1 pending, score 2 not.
      const seed = new FakeRealm();
      seed.addSet(fakeSet(1));
      seed.addBeatmap(fakeBeatmap(1, 1, { LastLocalUpdate: OLD }));
      seed.addScore(fakeScore(1, 1, { DeletePending: true, Date: OLD }));
      seed.addScore(fakeScore(2, 1, { DeletePending: false, Date: OLD }));
      seedMirror(db, seed);

      const pendingBefore = db
        .select({ n: count() })
        .from(scores)
        .where(eq(scores.deletePending, true))
        .get()?.n;
      expect(pendingBefore).toBe(1); // counts match the Realm count of 1

      const writer = new DeltaWriter(db, realm, NO_WATERMARK);
      healFlaggedRows(writer, db, realm);

      const flag = (n: number) =>
        db
          .select({ p: scores.deletePending })
          .from(scores)
          .where(eq(scores.id, scoreId(n)))
          .get()?.p;
      expect(flag(1)).toBe(false);
      expect(flag(2)).toBe(true);
      expect(writer.changedScores.toList()?.sort()).toEqual(
        [scoreId(1), scoreId(2)].sort(),
      );
    });

    test("equal hidden-beatmap and soft-set counts but different ids heal", () => {
      const realm = new FakeRealm();
      realm.addSet(fakeSet(1, { DeletePending: false }));
      realm.addSet(fakeSet(2, { DeletePending: true }));
      realm.addBeatmap(fakeBeatmap(1, 1, { Hidden: false, LastLocalUpdate: OLD }));
      realm.addBeatmap(fakeBeatmap(2, 1, { Hidden: true, LastLocalUpdate: OLD }));

      const seed = new FakeRealm();
      seed.addSet(fakeSet(1, { DeletePending: true }));
      seed.addSet(fakeSet(2, { DeletePending: false }));
      seed.addBeatmap(fakeBeatmap(1, 1, { Hidden: true, LastLocalUpdate: OLD }));
      seed.addBeatmap(fakeBeatmap(2, 1, { Hidden: false, LastLocalUpdate: OLD }));
      seedMirror(db, seed);

      const writer = new DeltaWriter(db, realm, NO_WATERMARK);
      healFlaggedRows(writer, db, realm);

      const hidden = (n: number) =>
        db
          .select({ h: beatmaps.hidden })
          .from(beatmaps)
          .where(eq(beatmaps.id, beatmapId(n)))
          .get()?.h;
      const pending = (n: number) =>
        db
          .select({ p: beatmapSets.deletePending })
          .from(beatmapSets)
          .where(eq(beatmapSets.id, setId(n)))
          .get()?.p;
      expect(hidden(1)).toBe(false);
      expect(hidden(2)).toBe(true);
      expect(pending(1)).toBe(false);
      expect(pending(2)).toBe(true);
    });

    test("identical id sets cause no Realm lookups or writes", () => {
      const realm = new FakeRealm();
      realm.addSet(fakeSet(1));
      realm.addBeatmap(fakeBeatmap(1, 1, { LastLocalUpdate: OLD }));
      realm.addScore(fakeScore(1, 1, { DeletePending: true, Date: OLD }));
      seedMirror(db, realm);
      realm.lookups.length = 0;

      const writer = new DeltaWriter(db, realm, NO_WATERMARK);
      healFlaggedRows(writer, db, realm);
      expect(realm.lookups).toEqual([]);
      expect(writer.rowsChanged).toBe(0);
    });

    test("a flagged id whose Realm object vanished is skipped, not an error", () => {
      const seed = new FakeRealm();
      seed.addSet(fakeSet(1));
      seed.addBeatmap(fakeBeatmap(1, 1, { LastLocalUpdate: OLD }));
      seed.addScore(fakeScore(1, 1, { DeletePending: true, Date: OLD }));
      seedMirror(db, seed);

      const realm = new FakeRealm(); // score 1 no longer exists
      const writer = new DeltaWriter(db, realm, NO_WATERMARK);
      expect(() => healFlaggedRows(writer, db, realm)).not.toThrow();
      expect(countOf(scores)).toBe(1);
    });
  });

  describe("incremental delta is streamed (F-013)", () => {
    test("beatmap delta of 1201 rows hydrates sets per 500-row batch, not all at once", () => {
      const realm = new FakeRealm();
      const total = 1201;
      for (let i = 1; i <= total; i++) {
        realm.addSet(fakeSet(i));
        realm.addBeatmap(
          fakeBeatmap(i, i, { LastLocalUpdate: new Date(2026, 1, 1, 0, 0, i) }),
        );
      }

      const writer = streamIncrementalDelta(db, realm, {
        maxPlayedAt: null,
        maxLastLocalUpdate: OLD,
      });

      expect(countOf(beatmaps)).toBe(total);
      expect(countOf(beatmapSets)).toBe(total);
      expect(writer.totals.beatmaps.attempted).toBe(total);

      // The first set lookup happens when exactly one batch (500) has been
      // pulled from Realm; a materialising implementation would see all 1201.
      const setLookups = realm.lookups.filter((l) => l.cls === "BeatmapSet");
      const seenAtLookup = [...new Set(setLookups.map((l) => l.yieldedAtLookup))];
      expect(seenAtLookup).toEqual([500, 1000, 1201]);
    });

    test("batch boundary: exactly 500 and 501 rows both land", () => {
      for (const total of [500, 501]) {
        const realm = new FakeRealm();
        realm.addSet(fakeSet(1));
        for (let i = 1; i <= total; i++) {
          realm.addBeatmap(
            fakeBeatmap(i, 1, { LastLocalUpdate: new Date(2026, 1, 1, 0, 0, i) }),
          );
        }
        const dbN = ensureDb(path.join(dir, `b${total}.sqlite`));
        const writer = streamIncrementalDelta(dbN, realm, {
          maxPlayedAt: null,
          maxLastLocalUpdate: OLD,
        });
        expect(writer.totals.beatmaps.attempted).toBe(total);
        expect(
          dbN.select({ n: count() }).from(beatmaps).get()?.n,
        ).toBe(total);
        closeDb(dbN);
      }
    });

    test("score batches hydrate missing beatmaps and sets per batch and null unresolved refs", () => {
      const realm = new FakeRealm();
      const total = 700;
      for (let i = 1; i <= total; i++) {
        realm.addSet(fakeSet(i));
        // Beatmap lastLocalUpdate is old: only scores are in the delta.
        realm.addBeatmap(fakeBeatmap(i, i, { LastLocalUpdate: OLD }));
        realm.addScore(
          fakeScore(i, i, { Date: new Date(2026, 2, 1, 0, 0, i) }),
        );
      }
      // Score referencing a beatmap that no longer exists in Realm.
      realm.addScore(fakeScore(9999, 424242, { Date: new Date(2026, 3, 1) }));

      const writer = streamIncrementalDelta(db, realm, {
        maxPlayedAt: OLD,
        maxLastLocalUpdate: OLD,
      });

      expect(countOf(scores)).toBe(total + 1);
      expect(countOf(beatmaps)).toBe(total);
      expect(countOf(beatmapSets)).toBe(total);
      const dangling = db
        .select({ b: scores.beatmapId })
        .from(scores)
        .where(eq(scores.id, scoreId(9999)))
        .get();
      expect(dangling?.b).toBeNull();

      // Beatmap hydration for the first batch precedes pulling the second.
      const firstBeatmapLookup = realm.lookups.find((l) => l.cls === "Beatmap")!;
      expect(firstBeatmapLookup.yieldedAtLookup).toBeLessThanOrEqual(500);
      expect(writer.changedBeatmaps.toList()?.length).toBe(total);
    });

    test("watermarks advance only from rows that upserted and cover every batch", () => {
      const realm = new FakeRealm();
      realm.addSet(fakeSet(1));
      const latestBeatmap = new Date(2026, 5, 1);
      const latestScore = new Date(2026, 6, 1);
      for (let i = 1; i <= 600; i++) {
        realm.addBeatmap(
          fakeBeatmap(i, 1, {
            LastLocalUpdate: i === 599 ? latestBeatmap : new Date(2026, 1, 1, 0, 0, i % 50),
          }),
        );
        realm.addScore(
          fakeScore(i, i, {
            Date: i === 600 ? latestScore : new Date(2026, 2, 1, 0, 0, i % 50),
          }),
        );
      }
      const writer = streamIncrementalDelta(db, realm, {
        maxPlayedAt: OLD,
        maxLastLocalUpdate: OLD,
      });
      expect(writer.watermarks.maxLastLocalUpdate?.getTime()).toBe(
        latestBeatmap.getTime(),
      );
      expect(writer.watermarks.maxPlayedAt?.getTime()).toBe(latestScore.getTime());
    });

    test("empty delta writes nothing and keeps the watermarks", () => {
      const realm = new FakeRealm();
      const wm = { maxPlayedAt: new Date(2026, 0, 2), maxLastLocalUpdate: new Date(2026, 0, 3) };
      const writer = streamIncrementalDelta(db, realm, wm);
      expect(writer.rowsChanged).toBe(0);
      expect(writer.watermarks).toEqual(wm);
      expect(writer.changedScores.toList()).toEqual([]);
    });
  });
});

/** Put a FakeRealm's full state into the local mirror (prior extraction). */
function seedMirror(db: Db, realm: FakeRealm) {
  const writer = new DeltaWriter(db, realm, NO_WATERMARK);
  writer.writeSets(
    [...realm.sets.values()].map((o) => mapBeatmapSet(o as never)!),
  );
  writer.writeBeatmaps(
    [...realm.beatmaps.values()].map((o) => mapBeatmap(o as never)!),
  );
  writer.writeScores(
    [...realm.scores.values()].map((o) => mapScore(o as never)!),
  );
}
