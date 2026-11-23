import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { closeDb, createDb } from "@roxysu/db/client.bun";
import { beatmapSets, beatmaps, scores } from "@roxysu/db/schema";
import type { Db } from "@roxysu/db/types";

import { previewScoreTransfer } from "./transfer";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(
  here,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "db",
  "drizzle",
);

const SET_ID = "00000000-0000-0000-0000-000000000050";
const MAP_ID = "00000000-0000-0000-0000-000000000051";
const MAP_MD5 = "a".repeat(32);
const PLAYED_AT = Date.parse("2024-01-01T00:00:00Z");

let db: Db;
let dir: string;

/** Upload rows: only the fields the matcher reads matter here. */
function uploadFile(rows: Array<Record<string, unknown>>): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: "roxysu-scores",
      version: 1,
      exportedAt: "2024-06-01T00:00:00.000Z",
      scores: rows,
    }),
  );
}

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    onlineId: 0,
    legacyOnlineId: 0,
    beatmapOnlineId: 0,
    beatmapMd5: null,
    beatmapHash: null,
    ruleset: "mania",
    totalScore: 1_000_000,
    playedAt: PLAYED_AT,
    ...overrides,
  };
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "roxysu-transfer-index-"));
  db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });

  db.insert(beatmapSets)
    .values({ id: SET_ID, onlineId: 1, dateAdded: new Date(PLAYED_AT), status: 2 })
    .run();
  db.insert(beatmaps)
    .values({
      id: MAP_ID,
      onlineId: 555,
      setId: SET_ID,
      status: 2,
      length: 120,
      bpm: 180,
      starRating: 4,
      rulesetShortName: "mania",
      md5Hash: MAP_MD5,
      hash: "b".repeat(64),
    })
    .run();
  db.insert(scores)
    .values({
      id: "score-1",
      onlineId: 10,
      legacyOnlineId: 77,
      beatmapId: MAP_ID,
      rulesetShortName: "mania",
      totalScore: 1_000_000,
      playedAt: new Date(PLAYED_AT),
    })
    .run();
});

afterAll(() => {
  closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("score transfer preview index", () => {
  test("classifies against only the rows the file can match", async () => {
    const bytes = uploadFile([
      // Same online id as the stored score.
      row({ onlineId: 10 }),
      // Same legacy id, different online id and play.
      row({ onlineId: 11, legacyOnlineId: 77, totalScore: 5 }),
      // Same play within the 5s fingerprint window, different online id.
      row({
        onlineId: 12,
        beatmapOnlineId: 555,
        beatmapMd5: MAP_MD5,
        playedAt: PLAYED_AT + 3_000,
      }),
      // Known beatmap but a different play → addable.
      row({
        onlineId: 13,
        beatmapOnlineId: 555,
        beatmapMd5: MAP_MD5,
        totalScore: 2_000_000,
        playedAt: PLAYED_AT + 3 * 86_400_000,
      }),
      // Beatmap not in the library → skipped.
      row({ onlineId: 14, beatmapOnlineId: 999 }),
    ]);

    const preview = await previewScoreTransfer(db, bytes, { dir });
    if ("error" in preview) throw new Error(preview.error);
    expect(preview).toMatchObject({
      found: 5,
      already: 3,
      add: 1,
      currentVersion: 0,
      skipped: 1,
      invalid: 0,
    });
  });

  test("an empty score list needs no queries and reports nothing", async () => {
    const preview = await previewScoreTransfer(db, uploadFile([]), { dir });
    if ("error" in preview) throw new Error(preview.error);
    expect(preview).toMatchObject({ found: 0, already: 0, add: 0, skipped: 0 });
  });
});
