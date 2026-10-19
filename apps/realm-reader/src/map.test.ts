import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmapSets,
  beatmaps,
  closeDb,
  ensureDb,
  eq,
  scores,
  type Db,
} from "@roxysu/db/client.bun";
import { mapBeatmap, mapBeatmapSet, mapScore } from "./map";
import { streamMappedUpsert } from "./upsert";

const SET_ID = "00000000-0000-0000-0000-000000000002";
const BEATMAP_ID = "00000000-0000-0000-0000-000000000001";
const SCORE_ID = "00000000-0000-0000-0000-000000000003";

function fakeBeatmap(starRating: unknown) {
  return {
    ID: BEATMAP_ID,
    OnlineID: -1,
    BeatmapSet: { ID: SET_ID, Files: [] },
    DifficultyName: "DP ANOTHER",
    Ruleset: { ShortName: "mania" },
    Status: 0,
    Length: 90,
    BPM: 180,
    StarRating: starRating,
    MD5Hash: null,
    Hash: null,
    Hidden: false,
    TotalObjectCount: 12,
    EndTimeObjectCount: 12,
  };
}

function fakeSet(overrides: Record<string, unknown> = {}) {
  return {
    ID: SET_ID,
    OnlineID: 1,
    DateAdded: new Date(2026, 0, 1),
    DateSubmitted: null,
    DateRanked: null,
    Status: 4,
    DeletePending: false,
    Hash: null,
    Protected: false,
    ...overrides,
  };
}

function fakeScore(overrides: Record<string, unknown> = {}) {
  return {
    ID: SCORE_ID,
    OnlineID: 1,
    LegacyOnlineID: 0,
    BeatmapInfo: { ID: BEATMAP_ID },
    BeatmapHash: null,
    Ruleset: { ShortName: "osu" },
    ClientVersion: null,
    TotalScore: 100,
    TotalScoreWithoutMods: 100,
    LegacyTotalScore: null,
    MaxCombo: 1,
    Combo: 1,
    Accuracy: 1,
    PP: null,
    Rank: 1,
    Mods: null,
    Statistics: null,
    MaximumStatistics: null,
    Date: new Date(2026, 0, 2),
    User: { OnlineID: 1, Username: "a" },
    IsLegacyScore: false,
    DeletePending: false,
    Hash: null,
    Files: [],
    ...overrides,
  };
}

/** beatmaps.set_id is an enforced foreign key (F-012): parents go in first. */
function seedSet(db: Db) {
  streamMappedUpsert(
    db,
    beatmapSets,
    [fakeSet()],
    (obj) => mapBeatmapSet(obj as never) as Record<string, unknown> | null,
    ["id"],
  );
}

describe("mapBeatmap star rating", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-map-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  test("stores a calculated star rating", () => {
    expect(mapBeatmap(fakeBeatmap(7.32))?.starRating).toBe(7.32);
  });

  test("stores NaN and Infinity star ratings as 0 so the row can be inserted", () => {
    seedSet(db);
    for (const starRating of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const row = mapBeatmap(fakeBeatmap(starRating));
      expect(row?.starRating).toBe(0);
      streamMappedUpsert(
        db,
        beatmaps,
        [fakeBeatmap(starRating)],
        (obj) => mapBeatmap(obj as never) as Record<string, unknown> | null,
        ["id"],
      );
    }

    const stored = db
      .select({ starRating: beatmaps.starRating })
      .from(beatmaps)
      .where(eq(beatmaps.id, BEATMAP_ID))
      .get();
    expect(stored?.starRating).toBe(0);
  });
});

describe("map soft-skip and date sanitization", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-map-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  test("null primary IDs soft-skip instead of throwing", () => {
    expect(mapBeatmapSet(fakeSet({ ID: null }))).toBeNull();
    expect(mapBeatmap({ ...fakeBeatmap(1), ID: null })).toBeNull();
    expect(mapScore(fakeScore({ ID: null }))).toBeNull();
  });

  test("Invalid DateAdded falls back to epoch so the set can insert", () => {
    const row = mapBeatmapSet(fakeSet({ DateAdded: new Date(Number.NaN) }));
    expect(row?.dateAdded.getTime()).toBe(0);
    streamMappedUpsert(
      db,
      beatmapSets,
      [fakeSet({ DateAdded: new Date(Number.NaN) })],
      (obj) => mapBeatmapSet(obj as never) as Record<string, unknown> | null,
      ["id"],
    );
    const stored = db
      .select({ dateAdded: beatmapSets.dateAdded })
      .from(beatmapSets)
      .where(eq(beatmapSets.id, SET_ID))
      .get();
    expect(stored?.dateAdded.getTime()).toBe(0);
  });

  test("Invalid score Date falls back to epoch so the score can insert", () => {
    const row = mapScore(fakeScore({ Date: new Date(Number.NaN) }));
    expect(row?.playedAt.getTime()).toBe(0);
    seedSet(db);
    streamMappedUpsert(
      db,
      beatmaps,
      [fakeBeatmap(1)],
      (obj) => mapBeatmap(obj as never) as Record<string, unknown> | null,
      ["id"],
    );
    streamMappedUpsert(
      db,
      scores,
      [fakeScore({ Date: new Date(Number.NaN) })],
      (obj) => mapScore(obj as never) as Record<string, unknown> | null,
      ["id"],
    );
    const stored = db
      .select({ playedAt: scores.playedAt })
      .from(scores)
      .where(eq(scores.id, SCORE_ID))
      .get();
    expect(stored?.playedAt.getTime()).toBe(0);
  });

  test("BMS scores keep ruleset, mods, and statistics without a special mapper", () => {
    const stats = JSON.stringify({ perfect: 2, great: 1, miss: 0 });
    const mods = JSON.stringify([{ acronym: "HS" }, { acronym: "CN" }]);
    const row = mapScore(
      fakeScore({
        Ruleset: { ShortName: "bms" },
        Statistics: stats,
        Mods: mods,
        TotalScore: 500000,
      }),
    );
    expect(row?.rulesetShortName).toBe("bms");
    expect(row?.statistics).toBe(stats);
    expect(row?.mods).toBe(mods);
    expect(row?.totalScore).toBe(500000);
    expect(row?.id).toBe(SCORE_ID);
  });

  test("optional Invalid dates become null", () => {
    const set = mapBeatmapSet(
      fakeSet({ DateSubmitted: new Date(Number.NaN) }),
    );
    expect(set?.dateSubmitted).toBeNull();
  });
});
