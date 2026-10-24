import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@roxysu/db/hub";
import { bmsScores, hubUsers } from "@roxysu/db/hub";
import { ingestBmsBatch, type BmsInbound, type HubDb } from "./bms";
import {
  bmsFeed,
  bmsGlobalStats,
  bmsTimeseries,
  chartLeaderboard,
  compareBmsProfiles,
  readBmsChart,
  readChartScore,
} from "./bmsCommunity";

const MD5 = "ab".repeat(16);
const OTHER = "cd".repeat(16);

/** Build EX/accuracy/judgement triples that pass Hub ingest validation. */
function scored(
  exScore: number,
  maxExScore: number,
): Pick<BmsInbound, "score" | "judgements"> {
  const pgreat = Math.floor(exScore / 2);
  const great = exScore % 2;
  const accuracy = maxExScore > 0 ? exScore / maxExScore : 0;
  return {
    judgements: { pgreat, great, good: 0, bad: 0, poor: 0, miss: 0 },
    score: {
      exScore,
      maxExScore,
      normalizedScore: Math.round(accuracy * 1_000_000),
      accuracy,
    },
  };
}

function inbound(
  localScoreId: string,
  patch: Partial<BmsInbound> & { chartMd5?: string } = {},
): BmsInbound {
  const md5 = patch.chartMd5 ?? MD5;
  const base = scored(100, 112);
  return {
    localScoreId,
    rulesetId: "bms",
    chart: { md5, title: "chart", artist: "anon", keyCount: 8, ...patch.chart },
    achievedAt: "2024-06-01T12:00:00.000Z",
    ...base,
    gameplay: {
      variantId: "standard",
      gaugeId: "hard",
      comboLampId: "fc",
      djGrade: "aaa",
      mods: [],
      ...patch.gameplay,
    },
    ...patch,
    chart: { md5, title: "chart", artist: "anon", keyCount: 8, ...patch.chart },
    gameplay: {
      variantId: "standard",
      gaugeId: "hard",
      comboLampId: "fc",
      djGrade: "aaa",
      mods: [],
      ...patch.gameplay,
    },
    score: { ...base.score, ...patch.score },
    judgements: { ...base.judgements, ...patch.judgements },
  };
}

let db: HubDb;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "roxysu-hub-bms-community-"));
  const sqlite = new Database(path.join(tmpDir, "hub.sqlite"));
  sqlite.exec("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema });
  const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
  migrate(db, { migrationsFolder: folder });
  await db.insert(hubUsers).values([
    { osuId: 1, username: "ada", avatarUrl: "https://example.test/a", countryCode: "JP" },
    { osuId: 2, username: "bea", avatarUrl: "https://example.test/b", countryCode: "US" },
    {
      osuId: 3,
      username: "cy",
      avatarUrl: "https://example.test/c",
      countryCode: "JP",
      bmsProfilePublic: false,
    },
  ]);
  await ingestBmsBatch(db, 1, "install-ada", [
    inbound("ada-best", { ...scored(100, 112) }),
    inbound("ada-worse", {
      ...scored(40, 112),
      achievedAt: "2024-06-02T12:00:00.000Z",
    }),
  ]);
  await ingestBmsBatch(db, 2, "install-bea", [
    inbound("bea-std", {
      ...scored(80, 120),
      gameplay: { variantId: "standard", gaugeId: "easy", djGrade: "a", comboLampId: null },
      achievedAt: "2024-06-02T08:00:00.000Z",
    }),
    inbound("bea-2p", {
      chartMd5: OTHER,
      ...scored(200, 200),
      gameplay: { variantId: "2P", gaugeId: "hard", djGrade: "max" },
    }),
  ]);
  await ingestBmsBatch(db, 3, "install-cy", [
    inbound("cy-secret", {
      ...scored(999, 999),
      achievedAt: new Date().toISOString(),
    }),
  ]);
});

afterAll(() => {
  db.$client.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("BMS community reads", () => {
  test("leaderboard keeps one public score per player and per variant", async () => {
    const missing = await chartLeaderboard(db, MD5, { variant: null });
    expect(missing).toEqual({ error: "variant is required" });
    const board = await chartLeaderboard(db, MD5, { variant: "standard", limit: 1 });
    expect(board && "scores" in board).toBe(true);
    if (!board || !("scores" in board)) return;
    expect(board.scores.map((row) => row.username)).toEqual(["ada"]);
    expect(board.scores[0]?.rank).toBe(1);
    expect(board.scores[0]?.exScore).toBe(100);
    expect(board.nextCursor).toBeTruthy();
    const next = await chartLeaderboard(db, MD5, {
      variant: "standard",
      limit: 1,
      cursor: board.nextCursor,
    });
    if (!next || !("scores" in next)) throw new Error("missing page");
    expect(next.scores.map((row) => row.username)).toEqual(["bea"]);
    expect(next.scores[0]?.rank).toBe(2);
    expect(next.nextCursor).toBeNull();

    const graded = await chartLeaderboard(db, MD5, { variant: "standard", achievement: "aa" });
    if (!graded || !("scores" in graded)) throw new Error("missing grade filter");
    expect(graded.scores.map((row) => row.username)).toEqual(["ada"]);

    const gauged = await chartLeaderboard(db, MD5, { variant: "standard", gauge: "hard" });
    if (!gauged || !("scores" in gauged)) throw new Error("missing gauge filter");
    expect(gauged.scores.map((row) => row.username)).toEqual(["ada"]);

    const country = await chartLeaderboard(db, MD5, { variant: "standard", country: "us" });
    if (!country || !("scores" in country)) throw new Error("missing country filter");
    expect(country.scores.map((row) => row.username)).toEqual(["bea"]);

    const other = await chartLeaderboard(db, OTHER, { variant: "2P" });
    if (!other || !("scores" in other)) throw new Error("missing variant board");
    expect(other.scores.map((row) => row.username)).toEqual(["bea"]);
    const mixed = await chartLeaderboard(db, OTHER, { variant: "standard" });
    if (!mixed || !("scores" in mixed)) throw new Error("missing empty board");
    expect(mixed.scores).toEqual([]);
  });

  test("a private score stays off the chart, the feed, and the totals", async () => {
    const chart = await readBmsChart(db, MD5);
    if (!chart || "error" in chart) throw new Error("missing chart");
    expect(chart.variants.find((row) => row.variantId === "standard")?.players).toBe(2);
    const secret = await db.select().from(bmsScores).where(eq(bmsScores.localScoreId, "cy-secret")).get();
    expect(await readChartScore(db, MD5, secret!.id, null)).toBeNull();
    expect((await readChartScore(db, MD5, secret!.id, 3))?.username).toBe("cy");

    const first = await bmsFeed(db, { limit: 2 });
    if ("error" in first) throw new Error(first.error);
    const again = await ingestBmsBatch(db, 1, "install-ada", [inbound("ada-best")]);
    expect(again.results[0]?.status).toBe("duplicate");
    const second = await bmsFeed(db, { limit: 2, cursor: first.nextCursor });
    if ("error" in second) throw new Error(second.error);
    const seen = [...first.scores, ...second.scores].map((row) => row.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(first.scores.some((row) => row.username === "cy")).toBe(false);
    expect(second.scores.some((row) => row.username === "cy")).toBe(false);
    const head = await bmsFeed(db, { limit: 20 });
    if ("error" in head) throw new Error(head.error);
    const headIds = new Set(head.scores.map((row) => row.id));
    for (const id of seen) expect(headIds.has(id)).toBe(true);
    expect(head.scores.some((row) => row.username === "cy")).toBe(false);

    await ingestBmsBatch(db, 1, "install-ada", [
      inbound("ada-now", {
        ...scored(10, 112),
        achievedAt: new Date().toISOString(),
      }),
    ]);
    const stats = await bmsGlobalStats(db);
    expect(stats.uniqueScores).toBe(5);
    expect(stats.recordedSubmissions).toBe(5);
    expect(stats.activePlayers).toBe(1);
    const series = await bmsTimeseries(db, {
      from: "2024-06-01T00:00:00.000Z",
      to: "2024-06-03T00:00:00.000Z",
      interval: "day",
    });
    if ("error" in series) throw new Error(series.error);
    expect(series.series.reduce((sum, day) => sum + day.plays, 0)).toBe(4);
  });

  test("comparison hides a private profile and ranks the public variant", async () => {
    expect(await compareBmsProfiles(db, "ada", "cy", null, { variant: "standard" })).toBeNull();
    const own = await compareBmsProfiles(db, "ada", "cy", 3, { variant: "standard" });
    expect(own && "players" in own).toBe(true);
    const compared = await compareBmsProfiles(db, "ada", "bea", null, { variant: "standard" });
    if (!compared || !("charts" in compared)) throw new Error("missing comparison");
    const shared = compared.charts.find((chart) => chart.chartMd5 === MD5);
    expect(shared?.ahead).toBe("a");
    expect(shared?.a?.exScore).toBe(100);
    expect(shared?.b?.exScore).toBe(80);
    expect(compared.charts.some((chart) => chart.chartMd5 === OTHER)).toBe(false);
  });
});
