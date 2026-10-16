import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beatmaps,
  closeDb,
  ensureDb,
  eq,
  type Db,
} from "@roxysu/db/client.bun";
import { mapBeatmap } from "./map";
import { streamMappedUpsert } from "./upsert";

const SET_ID = "00000000-0000-0000-0000-000000000002";

function fakeBeatmap(starRating: unknown) {
  return {
    ID: "00000000-0000-0000-0000-000000000001",
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
      .where(eq(beatmaps.id, "00000000-0000-0000-0000-000000000001"))
      .get();
    expect(stored?.starRating).toBe(0);
  });
});
