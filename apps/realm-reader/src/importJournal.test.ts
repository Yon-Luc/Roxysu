import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapSets,
  closeDb,
  count,
  ensureDb,
  eq,
  imports,
  scores,
  type Db,
} from "@roxysu/db/client.bun";
import {
  claimImport,
  commitImport,
  failImport,
  getWatermarks,
  hasSuccessfulImport,
  type ImportCounts,
} from "./importJournal";
import { reconcileDeletes } from "./reconcileCore";
import { DeltaWriter } from "./deltaCore";
import { mapBeatmap, mapBeatmapSet, mapScore } from "./map";
import { streamMappedUpsert } from "./upsert";
import { FakeRealm, fakeBeatmap, fakeScore, fakeSet, setId } from "./testFixtures";

const NO_WATERMARK = { maxPlayedAt: null, maxLastLocalUpdate: null };

const ZERO_COUNTS: ImportCounts = {
  beatmapSetsUpserted: 0,
  beatmapsUpserted: 0,
  scoresUpserted: 0,
  rowsChanged: 0,
  scoresDeleted: 0,
  beatmapsDeleted: 0,
  beatmapSetsDeleted: 0,
  changedScoreIds: null,
  changedBeatmapIds: null,
};

describe("import journal commit phase (F-009)", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-journal-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  const importStatus = (id: number) =>
    db
      .select({ status: imports.status })
      .from(imports)
      .where(eq(imports.id, id))
      .get()?.status;

  function* setObjects(total: number, throwAfter: number) {
    for (let i = 1; i <= total; i++) {
      if (i > throwAfter) throw new Error("simulated crash mid-extraction");
      yield fakeSet(i);
    }
  }

  test("a full extraction killed mid-stream leaves no success and no cursor", () => {
    const importRow = claimImport(db, "full");
    // Stream with autocommit like runFullSync, then fail after 1100 rows.
    try {
      streamMappedUpsert(
        db,
        beatmapSets,
        setObjects(2000, 1100),
        (obj) => mapBeatmapSet(obj as never) as Record<string, unknown> | null,
        ["id"],
      );
    } catch (err) {
      failImport(db, importRow.id, err);
    }

    // Earlier batches are committed (short locks), but the mirror is not trusted.
    expect(db.select({ n: count() }).from(beatmapSets).get()?.n).toBe(1000);
    expect(importStatus(importRow.id)).toBe("failed");
    expect(hasSuccessfulImport(db)).toBe(false);
    // Rows exist, yet no cursor is derived from them: the next cycle bootstraps.
    expect(getWatermarks(db)).toEqual(NO_WATERMARK);
  });

  test("an import still `running` (hard kill) is not a success and gives no cursor", () => {
    const importRow = claimImport(db, "full");
    const realm = new FakeRealm();
    realm.addSet(fakeSet(1));
    realm.addBeatmap(fakeBeatmap(1, 1, { LastLocalUpdate: new Date(2026, 1, 1) }));
    realm.addScore(fakeScore(1, 1, { Date: new Date(2026, 2, 1) }));
    const w = new DeltaWriter(db, realm, NO_WATERMARK);
    w.writeSets([mapBeatmapSet(realm.sets.get(setId(1)) as never)!]);
    w.writeBeatmaps([...realm.beatmaps.values()].map((o) => mapBeatmap(o as never)!));
    w.writeScores([...realm.scores.values()].map((o) => mapScore(o as never)!));

    expect(importStatus(importRow.id)).toBe("running");
    expect(hasSuccessfulImport(db)).toBe(false);
    expect(getWatermarks(db)).toEqual(NO_WATERMARK);
  });

  test("commit failure rolls back deletes and the success flip together", () => {
    const realm = new FakeRealm();
    realm.addSet(fakeSet(1));
    realm.addBeatmap(fakeBeatmap(1, 1));
    realm.addScore(fakeScore(1, 1));
    realm.addScore(fakeScore(2, 1));
    const w = new DeltaWriter(db, realm, NO_WATERMARK);
    w.writeSets([mapBeatmapSet(realm.sets.get(setId(1)) as never)!]);
    w.writeBeatmaps([...realm.beatmaps.values()].map((o) => mapBeatmap(o as never)!));
    w.writeScores([...realm.scores.values()].map((o) => mapScore(o as never)!));

    const importRow = claimImport(db, "full");
    expect(() =>
      commitImport(db, importRow.id, (tx) => {
        // Both scores are orphans in the (empty) Realm.
        const deleted = reconcileDeletes(tx, new Set(), new Set(), new Set());
        expect(deleted.scoresDeleted).toBe(2);
        throw new Error("crash inside commit phase");
      }),
    ).toThrow("crash inside commit phase");

    expect(db.select({ n: count() }).from(scores).get()?.n).toBe(2);
    expect(importStatus(importRow.id)).toBe("running");
    expect(hasSuccessfulImport(db)).toBe(false);
  });

  test("a successful commit applies deletes, success, and watermarks together", () => {
    const realm = new FakeRealm();
    realm.addSet(fakeSet(1));
    realm.addBeatmap(fakeBeatmap(1, 1));
    realm.addScore(fakeScore(1, 1));
    const w = new DeltaWriter(db, realm, NO_WATERMARK);
    w.writeSets([mapBeatmapSet(realm.sets.get(setId(1)) as never)!]);
    w.writeBeatmaps([...realm.beatmaps.values()].map((o) => mapBeatmap(o as never)!));
    w.writeScores([...realm.scores.values()].map((o) => mapScore(o as never)!));

    const importRow = claimImport(db, "full");
    const playedAt = new Date(2026, 2, 1);
    const updatedAt = new Date(2026, 1, 1);
    const deleted = commitImport(db, importRow.id, (tx) => {
      const deleted = reconcileDeletes(
        tx,
        new Set(),
        new Set([fakeBeatmap(1, 1).ID as string]),
        new Set([setId(1)]),
      );
      return {
        counts: { ...ZERO_COUNTS, scoresDeleted: deleted.scoresDeleted },
        watermarks: { maxPlayedAt: playedAt, maxLastLocalUpdate: updatedAt },
        result: deleted,
      };
    });

    expect(deleted.scoresDeleted).toBe(1);
    expect(db.select({ n: count() }).from(scores).get()?.n).toBe(0);
    expect(importStatus(importRow.id)).toBe("success");
    expect(hasSuccessfulImport(db)).toBe(true);
    const wm = getWatermarks(db);
    expect(wm.maxPlayedAt?.getTime()).toBe(playedAt.getTime());
    expect(wm.maxLastLocalUpdate?.getTime()).toBe(updatedAt.getTime());
  });

  test("a failed later cycle keeps the previous success cursor", () => {
    const first = claimImport(db, "full");
    const playedAt = new Date(2026, 2, 1);
    commitImport(db, first.id, () => ({
      counts: ZERO_COUNTS,
      watermarks: { maxPlayedAt: playedAt, maxLastLocalUpdate: null },
      result: undefined,
    }));

    const second = claimImport(db, "incremental");
    failImport(db, second.id, new Error("boom"));

    expect(getWatermarks(db).maxPlayedAt?.getTime()).toBe(playedAt.getTime());
  });

  test("a success that recorded no watermark falls back to table maxima", () => {
    const realm = new FakeRealm();
    realm.addSet(fakeSet(1));
    realm.addBeatmap(fakeBeatmap(1, 1, { LastLocalUpdate: new Date(2026, 1, 1) }));
    realm.addScore(fakeScore(1, 1, { Date: new Date(2026, 2, 1) }));
    const w = new DeltaWriter(db, realm, NO_WATERMARK);
    w.writeSets([mapBeatmapSet(realm.sets.get(setId(1)) as never)!]);
    w.writeBeatmaps([...realm.beatmaps.values()].map((o) => mapBeatmap(o as never)!));
    w.writeScores([...realm.scores.values()].map((o) => mapScore(o as never)!));

    const row = claimImport(db, "full");
    commitImport(db, row.id, () => ({
      counts: ZERO_COUNTS,
      watermarks: NO_WATERMARK,
      result: undefined,
    }));

    const wm = getWatermarks(db);
    expect(wm.maxPlayedAt?.getTime()).toBe(new Date(2026, 2, 1).getTime());
    expect(wm.maxLastLocalUpdate?.getTime()).toBe(new Date(2026, 1, 1).getTime());
  });
});
