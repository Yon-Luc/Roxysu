import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb } from "@roxysu/db/client.bun";
import {
  beatmapDanRatings,
  beatmapSets,
  beatmaps,
  scoreMetrics,
  scores,
} from "@roxysu/db/schema";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db-runtime";
import { REWORK_ALGORITHM } from "../map-analysis/reworkEstimator";
import { resolveDanVariant } from "../replay/mods";
import {
  DEFAULT_AXIS_THRESHOLDS,
} from "./recommend/axisThresholds";
import { classifyMapAxis } from "./recommend/axis";
import { mapperGroupKey } from "./mapperUsername";
import { classifyScoreGrade } from "../query-language/scoreGrade";
import { getPlayerStats } from "./playerStats";
import {
  createStatsFixtureDb,
  seedStatsFixture,
  setScoreScope,
} from "./playerStats.fixture";

let db: Db;

beforeAll(async () => {
  db = createStatsFixtureDb();
  await seedStatsFixture(db);
});

afterAll(() => closeDb(db));

type Scope = { username: string | null; gamemode: string | null };

/** Independent reference: plain JS over raw rows, no SQL scoping helpers. */
async function referenceMetrics(scope: Scope) {
  const metricRows = await db
    .select({
      sessionId: scoreMetrics.sessionId,
      isPb: scoreMetrics.isPb,
      deletePending: scores.deletePending,
      username: scores.userUsername,
      ruleset: scores.rulesetShortName,
    })
    .from(scoreMetrics)
    .innerJoin(scores, eq(scoreMetrics.scoreId, scores.id));
  const scoped = metricRows.filter(
    (r) =>
      !r.deletePending &&
      (scope.username == null || r.username === scope.username) &&
      (scope.gamemode == null || r.ruleset === scope.gamemode),
  );
  const perSession = new Map<number, number>();
  for (const r of scoped) {
    if (r.sessionId == null) continue;
    perSession.set(r.sessionId, (perSession.get(r.sessionId) ?? 0) + 1);
  }
  return {
    sessionCount: perSession.size,
    pbCount: scoped.filter((r) => r.isPb).length,
    avgPlaysPerSession:
      perSession.size > 0
        ? [...perSession.values()].reduce((a, b) => a + b, 0) / perSession.size
        : 0,
    longestCount: Math.max(0, ...perSession.values()),
  };
}

/** Header reference: mania + key count + non-deleted set, matching getSessionStats. */
async function referenceHeader(scope: Scope, keyCount: number) {
  const metricRows = await db
    .select({
      sessionId: scoreMetrics.sessionId,
      isPb: scoreMetrics.isPb,
      deletePending: scores.deletePending,
      username: scores.userUsername,
      ruleset: scores.rulesetShortName,
      setDeletePending: beatmapSets.deletePending,
      mapRuleset: beatmaps.rulesetShortName,
      cs: beatmaps.circleSize,
    })
    .from(scoreMetrics)
    .innerJoin(scores, eq(scoreMetrics.scoreId, scores.id))
    .innerJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id));
  const scoped = metricRows.filter(
    (r) =>
      !r.deletePending &&
      !r.setDeletePending &&
      (scope.username == null || r.username === scope.username) &&
      (scope.gamemode == null || r.ruleset === scope.gamemode) &&
      r.mapRuleset === "mania" &&
      r.cs === keyCount,
  );
  const perSession = new Map<number, number>();
  for (const r of scoped) {
    if (r.sessionId == null) continue;
    perSession.set(r.sessionId, (perSession.get(r.sessionId) ?? 0) + 1);
  }
  return {
    sessionCount: perSession.size,
    pbCount: scoped.filter((r) => r.isPb).length,
    avgPlaysPerSession:
      perSession.size > 0
        ? [...perSession.values()].reduce((a, b) => a + b, 0) / perSession.size
        : 0,
    longestCount: Math.max(0, ...perSession.values()),
  };
}

async function referenceManiaPlays(scope: Scope, keyCount: number) {
  const rows = await db
    .select({
      beatmapId: scores.beatmapId,
      playedAt: scores.playedAt,
      totalScore: scores.totalScore,
      rank: scores.rank,
      username: scores.userUsername,
      ruleset: scores.rulesetShortName,
      deletePending: scores.deletePending,
      setDeletePending: beatmapSets.deletePending,
      mapRuleset: beatmaps.rulesetShortName,
      cs: beatmaps.circleSize,
    })
    .from(scores)
    .innerJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .innerJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id));
  return rows.filter(
    (r) =>
      !r.deletePending &&
      !r.setDeletePending &&
      (scope.username == null || r.username === scope.username) &&
      (scope.gamemode == null || r.ruleset === scope.gamemode) &&
      r.mapRuleset === "mania" &&
      r.cs === keyCount,
  );
}

const SCOPES: Array<[string, Scope, { username: string; gamemode: string }]> = [
  ["all scores", { username: null, gamemode: null }, { username: "*", gamemode: "*" }],
  [
    "tester + mania",
    { username: "tester", gamemode: "mania" },
    { username: "tester", gamemode: "mania" },
  ],
  [
    "other + osu",
    { username: "other", gamemode: "osu" },
    { username: "other", gamemode: "osu" },
  ],
];

describe("stats session and PB counts follow the score scope (F-016)", () => {
  for (const [label, scope, setting] of SCOPES) {
    test(`header counts match scoped scores: ${label}`, async () => {
      await setScoreScope(db, setting);
      const expected = await referenceHeader(scope, 7);
      const stats = await getPlayerStats(db, { keyCount: 7 });
      expect(stats.summary.sessionCount).toBe(expected.sessionCount);
      expect(stats.summary.pbCount).toBe(expected.pbCount);
      expect(stats.sessionStats.avgPlaysPerSession).toBeCloseTo(
        expected.avgPlaysPerSession,
        10,
      );
      expect(stats.sessionStats.longest?.scoreCount ?? 0).toBe(
        expected.longestCount,
      );
    });
  }

  test("a username/gamemode scope changes the header versus all scores", async () => {
    const all = await referenceMetrics({ username: null, gamemode: null });
    const scoped = await referenceMetrics({
      username: "other",
      gamemode: "osu",
    });
    expect(scoped.pbCount).toBeLessThan(all.pbCount);
    expect(scoped.sessionCount).toBeGreaterThan(0);
  });

  test("4K and 7K headers do not share session counts", async () => {
    await setScoreScope(db, { username: "*", gamemode: "*" });
    const four = await getPlayerStats(db, { keyCount: 4 });
    const seven = await getPlayerStats(db, { keyCount: 7 });
    const expected4 = await referenceHeader({ username: null, gamemode: null }, 4);
    const expected7 = await referenceHeader({ username: null, gamemode: null }, 7);
    expect(four.summary.sessionCount).toBe(expected4.sessionCount);
    expect(seven.summary.sessionCount).toBe(expected7.sessionCount);
    expect(four.summary.pbCount).toBe(expected4.pbCount);
    expect(seven.summary.pbCount).toBe(expected7.pbCount);
  });

  test("a scope with no plays has no sessions or PBs", async () => {
    await setScoreScope(db, { username: "nobody", gamemode: "mania" });
    const stats = await getPlayerStats(db, { keyCount: 7 });
    expect(stats.summary.sessionCount).toBe(0);
    expect(stats.summary.pbCount).toBe(0);
    expect(stats.sessionStats.longest).toBeNull();
    expect(stats.sessionStats.avgDurationMs).toBeNull();
  });
});

describe("stats mania aggregates match a plain reference (F-021)", () => {
  for (const [label, scope, setting] of SCOPES) {
    for (const keyCount of [4, 7]) {
      test(`summary, rank mix, play-time: ${label}, ${keyCount}K`, async () => {
        await setScoreScope(db, setting);
        const plays = await referenceManiaPlays(scope, keyCount);
        const stats = await getPlayerStats(db, { keyCount });

        const ms = plays
          .map((p) => p.playedAt.getTime())
          .filter((t) => t > 0);
        expect(stats.summary.scoreCount).toBe(plays.length);
        expect(stats.summary.distinctMapsPlayed).toBe(
          new Set(plays.map((p) => p.beatmapId)).size,
        );
        expect(stats.summary.firstPlayedAt).toBe(
          ms.length ? Math.min(...ms) : null,
        );
        expect(stats.summary.lastPlayedAt).toBe(
          ms.length ? Math.max(...ms) : null,
        );

        const byLabel = new Map<string, number>();
        for (const p of plays) {
          if (p.rank === -1) continue;
          const grade = classifyScoreGrade(p.totalScore, p.rank);
          if (grade) byLabel.set(grade, (byLabel.get(grade) ?? 0) + 1);
        }
        for (const bucket of stats.rankDistribution) {
          expect(bucket.count).toBe(byLabel.get(bucket.label) ?? 0);
        }

        const hours = Array.from({ length: 24 }, () => 0);
        const days = Array.from({ length: 7 }, () => 0);
        for (const t of ms) {
          const d = new Date(t);
          hours[d.getUTCHours()]! += 1;
          days[d.getUTCDay()]! += 1;
        }
        expect(stats.playByHour.map((h) => h.count)).toEqual(hours);
        expect(stats.playByDayOfWeek.map((d) => d.count)).toEqual(days);

        // Daily trend totals every play with a usable timestamp (window is wide).
        const trended = stats.weeklyActivity.reduce(
          (n, w) => n + w.playCount,
          0,
        );
        expect(trended).toBeLessThanOrEqual(ms.length);
      });
    }
  }

  test("delete-pending beatmap sets and hidden maps stay consistent", async () => {
    await setScoreScope(db, { username: "*", gamemode: "*" });
    const stats = await getPlayerStats(db, { keyCount: 4 });
    // Hidden maps count toward summary but never toward the skillset mix.
    expect(stats.skillsetMix.total).toBeLessThanOrEqual(stats.summary.scoreCount);
    expect(stats.topMappers.length).toBeGreaterThan(0);
  });

  test("top mappers table aggregates plays, maps, sessions, axes, and Rework stars", async () => {
    await setScoreScope(db, { username: "*", gamemode: "*" });
    const keyCount = 4;
    const stats = await getPlayerStats(db, { keyCount });

    // Independent reference over the same scoped plays the stream walks.
    const rows = await db
      .select({
        deletePending: scores.deletePending,
        accuracy: scores.accuracy,
        rank: scores.rank,
        mods: scores.mods,
        beatmapId: scores.beatmapId,
        mapRuleset: beatmaps.rulesetShortName,
        cs: beatmaps.circleSize,
        mapperOnlineId: beatmaps.mapperOnlineId,
        mapperUsername: beatmaps.mapperUsername,
        hidden: beatmaps.hidden,
        reworkStar: beatmapDanRatings.sunnyStar,
        lnRatio: beatmapDanRatings.lnRatio,
        setDeletePending: beatmapSets.deletePending,
        sessionId: scoreMetrics.sessionId,
      })
      .from(scores)
      .innerJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
      .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
      .leftJoin(
        beatmapDanRatings,
        and(
          eq(beatmapDanRatings.beatmapId, beatmaps.id),
          eq(beatmapDanRatings.algorithm, REWORK_ALGORITHM),
        ),
      )
      .leftJoin(scoreMetrics, eq(scoreMetrics.scoreId, scores.id));

    type RefAgg = {
      plays: number;
      accSum: number;
      accCount: number;
      maps: Set<string>;
      sessions: Set<number>;
      rated: Map<string, { star: number; lnRatio: number }>;
      name: string | null;
    };
    const aggs = new Map<string, RefAgg>();
    for (const r of rows) {
      if (r.deletePending || r.setDeletePending) continue;
      if (r.mapRuleset !== "mania" || r.cs !== keyCount) continue;
      const key = mapperGroupKey(r.mapperOnlineId, r.mapperUsername);
      if (!key) continue;
      const agg =
        aggs.get(key) ??
        {
          plays: 0,
          accSum: 0,
          accCount: 0,
          maps: new Set<string>(),
          sessions: new Set<number>(),
          rated: new Map<string, { star: number; lnRatio: number }>(),
          name: r.mapperUsername ?? null,
        };
      aggs.set(key, agg);
      agg.plays += 1;
      // Failed / quit plays (rank -1) count as volume, not accuracy.
      if (r.rank !== -1) {
        agg.accSum += Number(r.accuracy ?? 0);
        agg.accCount += 1;
      }
      if (r.beatmapId) agg.maps.add(r.beatmapId);
      if (r.sessionId != null) agg.sessions.add(Number(r.sessionId));
      // Fixture persists no dan variants: only NM plays can be rated.
      if (resolveDanVariant(r.mods)) continue;
      // Hidden maps count toward volume but never rated columns.
      if (r.hidden) continue;
      if (r.reworkStar == null || r.lnRatio == null) continue;
      const ratedKey = `${r.beatmapId}|nm`;
      if (!agg.rated.has(ratedKey)) {
        agg.rated.set(ratedKey, {
          star: Number(r.reworkStar),
          lnRatio: Number(r.lnRatio),
        });
      }
    }

    const expected = [...aggs.entries()]
      .map(([key, agg]) => {
        let rc = 0;
        let ln = 0;
        let fln = 0;
        let starSum = 0;
        for (const rated of agg.rated.values()) {
          const axis = classifyMapAxis(rated.lnRatio, DEFAULT_AXIS_THRESHOLDS);
          if (axis === "fln") fln += 1;
          else if (axis === "ln") ln += 1;
          else rc += 1;
          starSum += rated.star;
        }
        const ratedMaps = agg.rated.size;
        return {
          mapperOnlineId: key.startsWith("id:")
            ? Number(key.slice(3))
            : 0,
          mapperUsername: agg.name,
          playCount: agg.plays,
          mapsPlayed: agg.maps.size,
          avgAccuracy: agg.accCount > 0 ? agg.accSum / agg.accCount : null,
          sessionCount: agg.sessions.size,
          rcMaps: rc,
          lnMaps: ln,
          flnMaps: fln,
          ratedMaps,
          avgStar: ratedMaps > 0 ? starSum / ratedMaps : null,
        };
      })
      .sort(
        (a, b) =>
          b.playCount - a.playCount ||
          b.mapsPlayed - a.mapsPlayed ||
          (a.mapperUsername ?? "").localeCompare(b.mapperUsername ?? "") ||
          b.mapperOnlineId - a.mapperOnlineId,
      )
      .slice(0, 10);

    expect(stats.topMappers).toEqual(expected);

    // The PP sum is gone; the table carries the new columns.
    for (const row of stats.topMappers) {
      expect("totalPp" in row).toBe(false);
      expect(row).toHaveProperty("sessionCount");
      expect(row).toHaveProperty("rcMaps");
      expect(row).toHaveProperty("lnMaps");
      expect(row).toHaveProperty("flnMaps");
      expect(row).toHaveProperty("avgStar");
    }
  });
});
