import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// better-sqlite3 cannot load under Bun, so the harness uses the Bun-side
// client; the SQLite dialect (and thus the SQL under test) is identical.
import {
  beatmapSets,
  closeDb,
  count,
  eq,
  ensureDb,
  type Db,
} from "@roxysu/db/client.bun";
import { streamMappedUpsert } from "./upsert";
import { mapBeatmapSet } from "./map";

/** Fake Realm object shaped like a lazer BeatmapSet row. */
function fakeSet(i: number) {
  return {
    ID: `${i.toString().padStart(32, "0")}-0000-0000-0000-000000000000`,
    OnlineID: i,
    DateAdded: new Date(2026, 0, 1),
    DateSubmitted: null,
    DateRanked: null,
    Status: 4,
    DeletePending: false,
    Hash: null,
    Protected: false,
  };
}

describe("streamMappedUpsert", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "roxysu-stream-"));
    db = ensureDb(path.join(dir, "data.sqlite"));
  });

  afterEach(() => {
    closeDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  function* fakeObjects(n: number) {
    for (let i = 0; i < n; i++) yield fakeSet(i);
  }

  test("upserts more rows than one batch in bounded passes", () => {
    const seen: string[] = [];
    // BATCH_SIZE is 500 internally — 1201 rows force 3 flushes.
    const result = streamMappedUpsert(
      db,
      beatmapSets,
      fakeObjects(1201),
      (obj) => mapBeatmapSet(obj as never) as Record<string, unknown> | null,
      ["id"],
      (row) => seen.push(row.id as string),
    );

    expect(result.attempted).toBe(1201);
    expect(seen.length).toBe(1201);
    expect(db.select({ n: count() }).from(beatmapSets).get()?.n).toBe(1201);
  });

  test("second identical pass changes nothing (conflict-set-where)", () => {
    streamMappedUpsert(
      db,
      beatmapSets,
      fakeObjects(600),
      (obj) => mapBeatmapSet(obj as never) as Record<string, unknown> | null,
      ["id"],
    );
    const again = streamMappedUpsert(
      db,
      beatmapSets,
      fakeObjects(600),
      (obj) => mapBeatmapSet(obj as never) as Record<string, unknown> | null,
      ["id"],
    );
    expect(again.attempted).toBe(600);
    expect(again.changed).toBe(0);
  });

  test("rows failing to map are skipped and not attempted", () => {
    function* mixed() {
      yield fakeSet(1);
      yield { ...fakeSet(2), ID: null }; // mapBeatmapSet throws → treat via wrapper
      yield fakeSet(3);
    }
    const result = streamMappedUpsert(
      db,
      beatmapSets,
      mixed(),
      (obj) => {
        try {
          return mapBeatmapSet(obj as never) as Record<string, unknown> | null;
        } catch {
          return null; // mirrors how the sync paths skip unmappable objects
        }
      },
      ["id"],
    );

    expect(result.attempted).toBe(2);
    const kept = db
      .select({ id: beatmapSets.id })
      .from(beatmapSets)
      .all()
      .map((r) => r.id);
    expect(kept.length).toBe(2);
  });

  test("changed counter reflects modified rows on re-upsert", () => {
    streamMappedUpsert(
      db,
      beatmapSets,
      fakeObjects(10),
      (obj) => mapBeatmapSet(obj as never) as Record<string, unknown> | null,
      ["id"],
    );
    const bumped = streamMappedUpsert(
      db,
      beatmapSets,
      (function* () {
        for (let i = 0; i < 10; i++) {
          const s = fakeSet(i);
          s.OnlineID = i + 100;
          yield s;
        }
      })(),
      (obj) => mapBeatmapSet(obj as never) as Record<string, unknown> | null,
      ["id"],
    );
    expect(bumped.changed).toBe(10);
    const updated = db
      .select({ onlineId: beatmapSets.onlineId })
      .from(beatmapSets)
      .where(eq(beatmapSets.id, fakeSet(0).ID))
      .get();
    expect(updated?.onlineId).toBe(100);
  });
});
