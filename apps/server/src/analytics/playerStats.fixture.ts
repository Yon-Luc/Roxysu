import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb } from "@roxysu/db/client.bun";
import {
  beatmapDanRatings,
  beatmapManiaRatings,
  beatmapSets,
  beatmaps,
  scoreMetrics,
  scores,
  sessions,
  settings,
} from "@roxysu/db/schema";
import {
  SCORES_GAMEMODE_FILTER_KEY,
  SCORES_USERNAME_FILTER_KEY,
} from "@roxysu/db/settings-keys";
import type { Db } from "../db-runtime";
import { SUNNY_ALGORITHM } from "../map-analysis/computeSunnyDan";
import { LAZER_MASTER_VERSION } from "../mania-rating/registry";

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

/** Deterministic PRNG so fixture output is stable across runs. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createStatsFixtureDb(): Db {
  const db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
  return db;
}

const DAY = 86_400_000;
export const FIXTURE_BASE_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

export type StatsFixtureOptions = {
  scoreCount?: number;
  beatmapCount?: number;
  seed?: number;
};

/**
 * Seed a mixed mirror: 4K/7K/non-mania beatmaps, two usernames, two rulesets,
 * deleted scores, a delete-pending set, modded plays, and sessions with PBs.
 */
export async function seedStatsFixture(
  db: Db,
  opts: StatsFixtureOptions = {},
): Promise<{ scoreIds: string[] }> {
  const scoreCount = opts.scoreCount ?? 400;
  const beatmapCount = opts.beatmapCount ?? 40;
  const rnd = mulberry32(opts.seed ?? 1234);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  const setRows: (typeof beatmapSets.$inferInsert)[] = [];
  const mapRows: (typeof beatmaps.$inferInsert)[] = [];
  const ratingRows: (typeof beatmapDanRatings.$inferInsert)[] = [];
  const curveRows: (typeof beatmapManiaRatings.$inferInsert)[] = [];
  const mappers: Array<[number | null, string | null]> = [
    [11, "alice"],
    [12, "bob"],
    [null, "legacy"],
    [null, null],
  ];

  for (let i = 0; i < beatmapCount; i++) {
    const setId = `set-${i}`;
    setRows.push({
      id: setId,
      onlineId: 1000 + i,
      dateAdded: new Date(FIXTURE_BASE_MS),
      status: 1,
      // One set is delete-pending: its plays must stay out of the rows.
      deletePending: i === 3,
    });
    const isMania = i % 9 !== 8;
    const cs = i % 3 === 0 ? 4 : 7;
    const [mapperOnlineId, mapperUsername] = mappers[i % mappers.length]!;
    const id = `map-${i}`;
    mapRows.push({
      id,
      onlineId: 5000 + i,
      setId,
      rulesetShortName: isMania ? "mania" : "osu",
      status: 1,
      length: 120_000,
      bpm: 180,
      starRating: 3 + (i % 7),
      hidden: i % 11 === 10,
      circleSize: cs,
      mapperOnlineId,
      mapperUsername,
    });
    if (isMania && i % 5 !== 4) {
      ratingRows.push({
        beatmapId: id,
        algorithm: SUNNY_ALGORITHM,
        sunnyStar: 3 + (i % 7) + rnd(),
        lnRatio: rnd(),
        estDiff: "x",
        updatedAt: new Date(FIXTURE_BASE_MS),
      });
    }
    if (isMania && i % 4 !== 3) {
      curveRows.push({
        beatmapId: id,
        versionId: LAZER_MASTER_VERSION,
        ppSs: 300 + i,
        ppByAccuracyJson: JSON.stringify({
          "90": 100 + i,
          "95": 160 + i,
          "98": 220 + i,
          "100": 300 + i,
        }),
        updatedAt: new Date(FIXTURE_BASE_MS),
      });
    }
  }
  await db.insert(beatmapSets).values(setRows);
  await db.insert(beatmaps).values(mapRows);
  if (ratingRows.length) await db.insert(beatmapDanRatings).values(ratingRows);
  if (curveRows.length) await db.insert(beatmapManiaRatings).values(curveRows);

  const modsPool = [
    null,
    null,
    null,
    "[]",
    '[{"acronym":"MR"}]',
    '[{"acronym":"DT"}]',
    '[{"acronym":"HD"}]',
  ] as const;
  const users = ["tester", "tester", "tester", "other"] as const;
  const rulesets = ["mania", "mania", "mania", "mania", "osu"] as const;

  const scoreRows: (typeof scores.$inferInsert)[] = [];
  for (let i = 0; i < scoreCount; i++) {
    const rank = pick([-1, 0, 1, 2, 3, 4, 5, 6, 7]);
    const perfect = rnd() < 0.03;
    scoreRows.push({
      id: `score-${i}`,
      onlineId: i + 1,
      legacyOnlineId: 0,
      beatmapId: `map-${Math.floor(rnd() * beatmapCount)}`,
      rulesetShortName: pick(rulesets),
      totalScore: perfect ? 1_000_000 : Math.floor(rnd() * 990_000),
      accuracy: 0.8 + rnd() * 0.2,
      pp: rnd() < 0.5 ? rnd() * 300 : null,
      rank,
      mods: pick(modsPool),
      // Spread over ~200 days, with a few unusable timestamps.
      playedAt: new Date(
        i % 97 === 0
          ? 0
          : FIXTURE_BASE_MS + Math.floor(rnd() * 200 * DAY),
      ),
      userUsername: pick(users),
      deletePending: i % 23 === 0,
    });
  }
  // insert in chunks (bun:sqlite variable limit)
  for (let i = 0; i < scoreRows.length; i += 100) {
    await db.insert(scores).values(scoreRows.slice(i, i + 100));
  }

  // Sessions: consecutive score ids grouped, PB flag on ~1/4.
  const sessionRows: (typeof sessions.$inferInsert)[] = [];
  const perSession = 20;
  const sessionCount = Math.ceil(scoreCount / perSession);
  for (let s = 0; s < sessionCount; s++) {
    const start = FIXTURE_BASE_MS + s * DAY;
    sessionRows.push({
      startedAt: new Date(start),
      endedAt: s % 5 === 4 ? null : new Date(start + 3_600_000 + s * 60_000),
      scoreCount: perSession,
    });
  }
  await db.insert(sessions).values(sessionRows);
  const metricRows: (typeof scoreMetrics.$inferInsert)[] = scoreRows.map(
    (row, i) => ({
      scoreId: row.id!,
      isPb: rnd() < 0.25,
      // First 3 scores have no session; others grouped (session ids are 1..n).
      sessionId: i < 3 ? null : Math.floor(i / perSession) + 1,
    }),
  );
  for (let i = 0; i < metricRows.length; i += 100) {
    await db.insert(scoreMetrics).values(metricRows.slice(i, i + 100));
  }

  return { scoreIds: scoreRows.map((r) => r.id!) };
}

/** Set the score scope (username + gamemode) the way Settings does. */
export async function setScoreScope(
  db: Db,
  scope: { username: string; gamemode: string },
) {
  for (const [key, value] of [
    [SCORES_USERNAME_FILTER_KEY, scope.username],
    [SCORES_GAMEMODE_FILTER_KEY, scope.gamemode],
  ] as const) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}
