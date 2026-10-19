import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { closeDb, createDb } from "@roxysu/db/client.bun";
import { scores } from "@roxysu/db/schema";
import type { Db } from "../db-runtime";
import { parseScoreTransferFile, type ScoreTransferFile } from "./format";
import { exportScoreTransferChunks, exportScoreTransferStream } from "./transfer";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, "..", "..", "..", "..", "packages", "db", "drizzle");
const EXPORTED_AT = "2026-10-19T12:00:00.000Z";

let db: Db;

function scoreRow(id: string, over: Partial<typeof scores.$inferInsert> = {}) {
  return {
    id,
    onlineId: 0,
    legacyOnlineId: 0,
    beatmapHash: `hash-${id}`,
    rulesetShortName: "mania",
    totalScore: 900_000,
    totalScoreWithoutMods: 900_000,
    maxCombo: 100,
    combo: 100,
    accuracy: 0.97,
    rank: 3,
    mods: "[]",
    statistics: '{"great":10}',
    maximumStatistics: '{"great":10}',
    playedAt: new Date(1_700_000_000_000 + Number(id.slice(1)) * 1000),
    userUsername: "me",
    ...over,
  } satisfies typeof scores.$inferInsert;
}

beforeAll(async () => {
  db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
  await db.insert(scores).values([
    scoreRow("s5"),
    scoreRow("s1", { onlineId: 11 }),
    scoreRow("s3", { rulesetShortName: null }), // skipped: no ruleset
    scoreRow("s2", { pp: 123.5 }),
    scoreRow("s4", { deletePending: true }), // excluded: soft-deleted
    scoreRow("s6", { mods: '[{"acronym":"DT"}]' }),
    scoreRow("s7"),
  ]);
});

afterAll(() => closeDb(db));

async function collect(chunkRows: number): Promise<string[]> {
  const out: string[] = [];
  for await (const piece of exportScoreTransferChunks(db, { chunkRows, exportedAt: EXPORTED_AT })) {
    out.push(piece);
  }
  return out;
}

describe("exportScoreTransferChunks", () => {
  test("concatenates to the exact JSON.stringify document shape", async () => {
    const text = (await collect(1_000)).join("");
    const parsed = JSON.parse(text) as ScoreTransferFile;
    expect(JSON.stringify(parsed)).toBe(text);
    expect(Object.keys(parsed)).toEqual(["format", "version", "exportedAt", "scores"]);
    expect(parsed.format).toBe("roxysu-scores");
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBe(EXPORTED_AT);
    // ordered by score id; s3 (no ruleset) and s4 (deleted) are absent
    expect(parsed.scores.map((s) => s.beatmapHash)).toEqual([
      "hash-s1",
      "hash-s2",
      "hash-s5",
      "hash-s6",
      "hash-s7",
    ]);
    expect(parsed.scores[0]).toMatchObject({
      onlineId: 11,
      ruleset: "mania",
      playedAt: 1_700_000_001_000,
      beatmapOnlineId: 0,
      isLegacy: false,
    });
    expect(parsed.scores[1]?.pp).toBe(123.5);
  });

  test("the export stays importable by the existing import path", async () => {
    const text = (await collect(2)).join("");
    const result = parseScoreTransferFile(JSON.parse(text));
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.invalid).toBe(0);
    expect(result.file.scores).toHaveLength(5);
  });

  test("output is identical for every page size, including page boundaries", async () => {
    const baseline = (await collect(1_000)).join("");
    for (const size of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect((await collect(size)).join("")).toBe(baseline);
    }
  });

  test("reads in bounded pages: at most chunkRows rows per yielded piece", async () => {
    const pieces = await collect(2);
    // header + pages (4 rows survive across pages of 2 source rows) + footer
    expect(pieces.length).toBeGreaterThan(3);
    for (const piece of pieces.slice(1, -1)) {
      const body = piece.startsWith(",") ? piece.slice(1) : piece;
      const rows = JSON.parse(`[${body}]`) as unknown[];
      expect(rows.length).toBeLessThanOrEqual(2);
    }
  });

  test("empty export is a valid document", async () => {
    const empty = createDb(":memory:");
    migrate(empty as Parameters<typeof migrate>[0], { migrationsFolder });
    try {
      let text = "";
      for await (const piece of exportScoreTransferChunks(empty, { exportedAt: EXPORTED_AT })) {
        text += piece;
      }
      expect(JSON.parse(text)).toEqual({
        format: "roxysu-scores",
        version: 1,
        exportedAt: EXPORTED_AT,
        scores: [],
      });
    } finally {
      closeDb(empty);
    }
  });
});

describe("exportScoreTransferStream", () => {
  test("a Response over the stream yields the same document", async () => {
    const expected = (await collect(1_000)).join("");
    const res = new Response(exportScoreTransferStream(db, { chunkRows: 2, exportedAt: EXPORTED_AT }));
    expect(await res.text()).toBe(expected);
  });

  test("cancel stops reading further pages", async () => {
    const stream = exportScoreTransferStream(db, { chunkRows: 1, exportedAt: EXPORTED_AT });
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel();
    expect((await reader.read()).done).toBe(true);
  });
});
