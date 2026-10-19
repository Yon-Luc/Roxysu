import { Database } from "bun:sqlite";
import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  bmsCharts,
  bmsScoreSubmissions,
  bmsScores,
  hubUsers,
} from "@roxysu/db/hub";
import {
  BMS_DJ_GRADES,
  BMS_GAUGE_IDS,
  gradeMeets,
  isKnownVariantId,
  type BmsDjGrade,
} from "@roxysu/db/bms";
import { listProfileScores, profileStats, tableCompletion, type HubDb } from "./bms";

const MAX_PAGE = 50;
const MAX_COMPARE_CHARTS = 80;
const MAX_SERIES_DAYS = 400;
const ACTIVE_WINDOW_SEC = 30 * 24 * 60 * 60;

const ACHIEVEMENTS = new Set(["a", "aa", "aaa", "max", "b", "d", "fc", "perfect", "max-lamp"]);

export const BMS_STAT_DEFINITIONS = {
  uniqueScores:
    "Accepted public plays. One stored score is one play. A retry of a score already stored is not another play.",
  recordedSubmissions:
    "One row per source score that was accepted or permanently rejected. A later retry does not add a row.",
  activePlayers: "Public profiles with at least one play achieved in the last 30 days.",
  timeseries:
    "Public accepted scores grouped by the UTC day they were achieved. Submission retries are not included.",
} as const;

type LeaderRow = {
  id: string;
  ex_score: number | null;
  max_ex_score: number | null;
  normalized_score: number | null;
  accuracy: number | null;
  dj_grade: string | null;
  combo_lamp_id: string | null;
  gauge_id: string | null;
  variant_id: string;
  achieved_at: number;
  trust: string;
  username: string;
  country_code: string | null;
  rank: number;
};

function achievementClause(achievement: string | null): string | null {
  if (!achievement) return "";
  if (!ACHIEVEMENTS.has(achievement)) return null;
  if (achievement === "fc") return "AND s.combo_lamp_id IN ('fc','perfect','max')";
  if (achievement === "perfect") return "AND s.combo_lamp_id IN ('perfect','max')";
  if (achievement === "max-lamp") return "AND s.combo_lamp_id = 'max'";
  const grades = BMS_DJ_GRADES.filter((grade) => gradeMeets(grade, achievement as BmsDjGrade));
  return `AND s.dj_grade IN (${grades.map((grade) => `'${grade}'`).join(",")})`;
}

function chartMd5(chartId: string): string | null {
  const md5 = chartId.toLowerCase();
  return /^[0-9a-f]{32}$/.test(md5) ? md5 : null;
}

function pageLimit(limit: number | null | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return 20;
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(limit)));
}

function sqlite(db: HubDb): Database {
  return (db as unknown as { $client: Database }).$client;
}

async function userByName(db: HubDb, username: string) {
  return db
    .select()
    .from(hubUsers)
    .where(sql`lower(${hubUsers.username}) = ${username.toLowerCase()}`)
    .get();
}

function visible(user: { id: number; bmsProfilePublic: boolean }, viewerId: number | null) {
  return user.bmsProfilePublic || viewerId === user.id;
}

export async function readBmsChart(db: HubDb, chartId: string) {
  const md5 = chartMd5(chartId);
  if (!md5) return { error: "invalid chart id" as const };
  const chart = await db.select().from(bmsCharts).where(eq(bmsCharts.md5, md5)).get();
  if (!chart) return null;
  const variants = await db
    .select({
      variantId: bmsScores.variantId,
      plays: sql<number>`count(*)`.mapWith(Number),
      players: sql<number>`count(distinct ${bmsScores.userId})`.mapWith(Number),
    })
    .from(bmsScores)
    .innerJoin(hubUsers, eq(hubUsers.id, bmsScores.userId))
    .where(and(eq(bmsScores.chartMd5, md5), eq(hubUsers.bmsProfilePublic, true)))
    .groupBy(bmsScores.variantId)
    .orderBy(desc(sql`count(*)`));
  return {
    md5: chart.md5,
    sha256: chart.sha256,
    title: chart.title,
    artist: chart.artist,
    keyCount: chart.keyCount,
    trust: "community_submitted" as const,
    variants,
  };
}

export async function readChartScore(
  db: HubDb,
  chartId: string,
  scoreId: string,
  viewerId: number | null,
) {
  const md5 = chartMd5(chartId);
  if (!md5) return { error: "invalid chart id" as const };
  if (!scoreId || scoreId.length > 80) return { error: "invalid score id" as const };
  const row = await db
    .select({
      id: bmsScores.id,
      achievedAt: bmsScores.achievedAt,
      chartMd5: bmsScores.chartMd5,
      title: bmsCharts.title,
      artist: bmsCharts.artist,
      keyCount: bmsCharts.keyCount,
      exScore: bmsScores.exScore,
      maxExScore: bmsScores.maxExScore,
      normalizedScore: bmsScores.normalizedScore,
      accuracy: bmsScores.accuracy,
      pgreat: bmsScores.pgreat,
      great: bmsScores.great,
      good: bmsScores.good,
      bad: bmsScores.bad,
      poor: bmsScores.poor,
      miss: bmsScores.miss,
      variantId: bmsScores.variantId,
      gaugeId: bmsScores.gaugeId,
      comboLampId: bmsScores.comboLampId,
      clearLampId: bmsScores.clearLampId,
      djGrade: bmsScores.djGrade,
      trust: bmsScores.trust,
      username: hubUsers.username,
      countryCode: hubUsers.countryCode,
      userId: hubUsers.id,
      profilePublic: hubUsers.bmsProfilePublic,
    })
    .from(bmsScores)
    .innerJoin(bmsCharts, eq(bmsCharts.md5, bmsScores.chartMd5))
    .innerJoin(hubUsers, eq(hubUsers.id, bmsScores.userId))
    .where(and(eq(bmsScores.id, scoreId), eq(bmsScores.chartMd5, md5)))
    .get();
  if (!row || !visible({ id: row.userId, bmsProfilePublic: row.profilePublic }, viewerId)) {
    return null;
  }
  const { userId: _userId, profilePublic: _public, ...score } = row;
  return {
    ...score,
    achievedAt: new Date(score.achievedAt).toISOString(),
  };
}

export async function chartLeaderboard(
  db: HubDb,
  chartId: string,
  input: {
    variant: string | null;
    achievement?: string | null;
    gauge?: string | null;
    country?: string | null;
    cursor?: string | null;
    limit?: number | null;
  },
) {
  const md5 = chartMd5(chartId);
  if (!md5) return { error: "invalid chart id" as const };
  if (!input.variant || !isKnownVariantId(input.variant)) {
    return { error: "variant is required" as const };
  }
  const gauge = input.gauge?.trim() ? input.gauge : null;
  if (gauge && !BMS_GAUGE_IDS.has(gauge)) return { error: "unknown gauge" as const };
  const country = input.country?.trim() ? input.country.toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) return { error: "invalid country" as const };
  const clause = achievementClause(input.achievement ?? null);
  if (clause == null) return { error: "unknown achievement" as const };
  const chart = await db.select({ md5: bmsCharts.md5 }).from(bmsCharts).where(eq(bmsCharts.md5, md5)).get();
  if (!chart) return null;

  let cursorSql = "";
  const params: Array<string | number | null> = [md5, input.variant, gauge, gauge, country, country];
  if (input.cursor) {
    const [exRaw, accRaw, atRaw, id] = input.cursor.split("|");
    const ex = Number(exRaw);
    const acc = Number(accRaw);
    const at = Number(atRaw);
    if (!Number.isFinite(ex) || !Number.isFinite(acc) || !Number.isFinite(at) || !id) {
      return { error: "invalid cursor" as const };
    }
    cursorSql = `
      AND (
        COALESCE(ex_score, -1) < ?
        OR (COALESCE(ex_score, -1) = ? AND COALESCE(accuracy, -1) < ?)
        OR (COALESCE(ex_score, -1) = ? AND COALESCE(accuracy, -1) = ? AND achieved_at > ?)
        OR (COALESCE(ex_score, -1) = ? AND COALESCE(accuracy, -1) = ? AND achieved_at = ? AND id > ?)
      )`;
    params.push(ex, ex, acc, ex, acc, at, ex, acc, at, id);
  }
  const limit = pageLimit(input.limit);
  params.push(limit + 1);
  const rows = sqlite(db)
    .prepare(
      `
      WITH best AS (
        SELECT
          s.id AS id,
          s.ex_score AS ex_score,
          s.max_ex_score AS max_ex_score,
          s.normalized_score AS normalized_score,
          s.accuracy AS accuracy,
          s.dj_grade AS dj_grade,
          s.combo_lamp_id AS combo_lamp_id,
          s.gauge_id AS gauge_id,
          s.variant_id AS variant_id,
          s.achieved_at AS achieved_at,
          s.trust AS trust,
          u.username AS username,
          u.country_code AS country_code,
          ROW_NUMBER() OVER (
            PARTITION BY s.user_id
            ORDER BY COALESCE(s.ex_score, -1) DESC,
                     COALESCE(s.accuracy, -1) DESC,
                     s.achieved_at ASC,
                     s.id ASC
          ) AS pick
        FROM bms_scores s
        INNER JOIN hub_users u ON u.id = s.user_id
        WHERE s.chart_md5 = ?
          AND s.variant_id = ?
          AND u.bms_profile_public = 1
          AND (? IS NULL OR s.gauge_id = ?)
          AND (? IS NULL OR upper(u.country_code) = ?)
          ${clause}
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (
            ORDER BY COALESCE(ex_score, -1) DESC,
                     COALESCE(accuracy, -1) DESC,
                     achieved_at ASC,
                     id ASC
          ) AS rank
        FROM best
        WHERE pick = 1
      )
      SELECT * FROM ranked
      WHERE 1 = 1
      ${cursorSql}
      ORDER BY rank
      LIMIT ?
      `,
    )
    .all(...params) as LeaderRow[];

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? `${last.ex_score ?? -1}|${last.accuracy ?? -1}|${last.achieved_at}|${last.id}`
      : null;
  return {
    variantId: input.variant,
    achievement: input.achievement ?? null,
    gauge,
    country,
    scores: page.map((row) => ({
      rank: row.rank,
      id: row.id,
      username: row.username,
      countryCode: row.country_code,
      exScore: row.ex_score,
      maxExScore: row.max_ex_score,
      normalizedScore: row.normalized_score,
      accuracy: row.accuracy,
      djGrade: row.dj_grade,
      comboLampId: row.combo_lamp_id,
      gaugeId: row.gauge_id,
      variantId: row.variant_id,
      achievedAt: new Date(row.achieved_at * 1000).toISOString(),
      trust: row.trust,
    })),
    nextCursor,
  };
}

export async function compareBmsProfiles(
  db: HubDb,
  playerA: string,
  playerB: string,
  viewerId: number | null,
  input: { variant: string | null; tableId?: string | null; achievement?: string | null },
) {
  if (playerA.toLowerCase() === playerB.toLowerCase()) {
    return { error: "pick two different players" as const };
  }
  if (!input.variant || !isKnownVariantId(input.variant)) {
    return { error: "variant is required" as const };
  }
  const left = await userByName(db, playerA);
  const right = await userByName(db, playerB);
  if (!left || !right || !visible(left, viewerId) || !visible(right, viewerId)) return null;

  const [statsA, statsB, scoresA, scoresB] = await Promise.all([
    profileStats(db, left.username, viewerId, input.variant),
    profileStats(db, right.username, viewerId, input.variant),
    listProfileScores(db, left.username, viewerId, { variant: input.variant, limit: 5 }),
    listProfileScores(db, right.username, viewerId, { variant: input.variant, limit: 5 }),
  ]);
  const achievement = input.achievement ?? "aa";
  const tables =
    input.tableId && ACHIEVEMENTS.has(achievement)
      ? await Promise.all([
          tableCompletion(db, left.username, viewerId, input.tableId, null, input.variant, achievement),
          tableCompletion(db, right.username, viewerId, input.tableId, null, input.variant, achievement),
        ])
      : [null, null];

  type ChartBest = {
    chartMd5: string;
    title: string | null;
    artist: string | null;
    exScore: number | null;
    accuracy: number | null;
    djGrade: string | null;
    comboLampId: string | null;
  };
  const rows = sqlite(db)
    .prepare(
      `
      WITH best AS (
        SELECT
          s.user_id AS user_id,
          s.chart_md5 AS chart_md5,
          c.title AS title,
          c.artist AS artist,
          s.ex_score AS ex_score,
          s.accuracy AS accuracy,
          s.dj_grade AS dj_grade,
          s.combo_lamp_id AS combo_lamp_id,
          ROW_NUMBER() OVER (
            PARTITION BY s.user_id, s.chart_md5
            ORDER BY COALESCE(s.ex_score, -1) DESC,
                     COALESCE(s.accuracy, -1) DESC,
                     s.achieved_at ASC,
                     s.id ASC
          ) AS pick
        FROM bms_scores s
        INNER JOIN bms_charts c ON c.md5 = s.chart_md5
        WHERE s.user_id IN (?, ?)
          AND s.variant_id = ?
          AND s.chart_md5 IN (
            SELECT chart_md5
            FROM bms_scores
            WHERE user_id IN (?, ?) AND variant_id = ?
            GROUP BY chart_md5
            ORDER BY max(COALESCE(ex_score, -1)) DESC
            LIMIT ?
          )
      )
      SELECT * FROM best WHERE pick = 1
      `,
    )
    .all(left.id, right.id, input.variant, left.id, right.id, input.variant, MAX_COMPARE_CHARTS) as Array<{
    user_id: number;
    chart_md5: string;
    title: string | null;
    artist: string | null;
    ex_score: number | null;
    accuracy: number | null;
    dj_grade: string | null;
    combo_lamp_id: string | null;
  }>;

  const byChart = new Map<string, { title: string | null; artist: string | null; a?: ChartBest; b?: ChartBest }>();
  for (const row of rows) {
    const slot = byChart.get(row.chart_md5) ?? { title: row.title, artist: row.artist };
    const best: ChartBest = {
      chartMd5: row.chart_md5,
      title: row.title,
      artist: row.artist,
      exScore: row.ex_score,
      accuracy: row.accuracy,
      djGrade: row.dj_grade,
      comboLampId: row.combo_lamp_id,
    };
    if (row.user_id === left.id) slot.a = best;
    else slot.b = best;
    byChart.set(row.chart_md5, slot);
  }
  const charts = [...byChart.entries()]
    .map(([chartMd5, slot]) => {
      const aEx = slot.a?.exScore ?? -1;
      const bEx = slot.b?.exScore ?? -1;
      const ahead = aEx === bEx ? "tie" : aEx > bEx ? "a" : "b";
      return { chartMd5, title: slot.title, artist: slot.artist, ahead, a: slot.a ?? null, b: slot.b ?? null };
    })
    .sort((x, y) => Math.max(y.a?.exScore ?? -1, y.b?.exScore ?? -1) - Math.max(x.a?.exScore ?? -1, x.b?.exScore ?? -1));

  return {
    variantId: input.variant,
    players: [
      {
        username: left.username,
        countryCode: left.countryCode,
        plays: statsA?.plays ?? 0,
        bestEx: statsA?.bestEx ?? null,
        grades: statsA?.grades ?? [],
        recent: scoresA?.scores ?? [],
        table: tables[0],
      },
      {
        username: right.username,
        countryCode: right.countryCode,
        plays: statsB?.plays ?? 0,
        bestEx: statsB?.bestEx ?? null,
        grades: statsB?.grades ?? [],
        recent: scoresB?.scores ?? [],
        table: tables[1],
      },
    ],
    charts,
  };
}

export async function bmsFeed(db: HubDb, input: { cursor?: string | null; limit?: number | null }) {
  const limit = pageLimit(input.limit);
  const filters = [eq(hubUsers.bmsProfilePublic, true)];
  if (input.cursor) {
    const [seconds, id] = input.cursor.split("|");
    const when = Number(seconds);
    if (!Number.isFinite(when) || !id) return { error: "invalid cursor" as const };
    filters.push(
      sql`(${bmsScores.createdAt} < ${when} OR (${bmsScores.createdAt} = ${when} AND ${bmsScores.id} < ${id}))`,
    );
  }
  const rows = await db
    .select({
      id: bmsScores.id,
      createdAt: bmsScores.createdAt,
      achievedAt: bmsScores.achievedAt,
      chartMd5: bmsScores.chartMd5,
      title: bmsCharts.title,
      artist: bmsCharts.artist,
      username: hubUsers.username,
      countryCode: hubUsers.countryCode,
      exScore: bmsScores.exScore,
      maxExScore: bmsScores.maxExScore,
      accuracy: bmsScores.accuracy,
      variantId: bmsScores.variantId,
      gaugeId: bmsScores.gaugeId,
      comboLampId: bmsScores.comboLampId,
      djGrade: bmsScores.djGrade,
      trust: bmsScores.trust,
    })
    .from(bmsScores)
    .innerJoin(hubUsers, eq(hubUsers.id, bmsScores.userId))
    .innerJoin(bmsCharts, eq(bmsCharts.md5, bmsScores.chartMd5))
    .where(and(...filters))
    .orderBy(desc(bmsScores.createdAt), desc(bmsScores.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const lastAt = last ? Math.floor(new Date(last.createdAt).getTime() / 1000) : 0;
  return {
    scores: page.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
      achievedAt: new Date(row.achievedAt).toISOString(),
    })),
    nextCursor: rows.length > limit && last ? `${lastAt}|${last.id}` : null,
  };
}

export async function bmsGlobalStats(db: HubDb) {
  const publicUser = eq(hubUsers.bmsProfilePublic, true);
  const [scores] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(bmsScores)
    .innerJoin(hubUsers, eq(hubUsers.id, bmsScores.userId))
    .where(publicUser);
  const submissions = await db
    .select({
      status: bmsScoreSubmissions.status,
      n: sql<number>`count(*)`.mapWith(Number),
    })
    .from(bmsScoreSubmissions)
    .innerJoin(hubUsers, eq(hubUsers.id, bmsScoreSubmissions.userId))
    .where(publicUser)
    .groupBy(bmsScoreSubmissions.status);
  const byStatus: Record<string, number> = {};
  for (const row of submissions) byStatus[row.status] = row.n;
  const since = Math.floor(Date.now() / 1000) - ACTIVE_WINDOW_SEC;
  const [active] = await db
    .select({ n: sql<number>`count(distinct ${bmsScores.userId})`.mapWith(Number) })
    .from(bmsScores)
    .innerJoin(hubUsers, eq(hubUsers.id, bmsScores.userId))
    .where(and(publicUser, sql`${bmsScores.achievedAt} >= ${since}`));
  const accepted = byStatus.accepted ?? 0;
  const rejected = byStatus.rejected ?? 0;
  return {
    uniqueScores: scores?.n ?? 0,
    recordedSubmissions: accepted + rejected,
    acceptedSubmissions: accepted,
    rejectedSubmissions: rejected,
    activePlayers: active?.n ?? 0,
    definitions: BMS_STAT_DEFINITIONS,
  };
}

export async function bmsTimeseries(
  db: HubDb,
  input: { from?: string | null; to?: string | null; interval?: string | null },
) {
  if (input.interval && input.interval !== "day") return { error: "interval must be day" as const };
  const to = input.to ? Date.parse(input.to) : Date.now();
  const from = input.from ? Date.parse(input.from) : to - 30 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return { error: "invalid range" as const };
  }
  if (to - from > MAX_SERIES_DAYS * 24 * 60 * 60 * 1000) {
    return { error: "range is too long" as const };
  }
  const rows = await db
    .select({
      day: sql<string>`date(${bmsScores.achievedAt}, 'unixepoch')`,
      plays: sql<number>`count(*)`.mapWith(Number),
    })
    .from(bmsScores)
    .innerJoin(hubUsers, eq(hubUsers.id, bmsScores.userId))
    .where(
      and(
        eq(hubUsers.bmsProfilePublic, true),
        gte(bmsScores.achievedAt, new Date(from)),
        lt(bmsScores.achievedAt, new Date(to)),
      ),
    )
    .groupBy(sql`date(${bmsScores.achievedAt}, 'unixepoch')`)
    .orderBy(asc(sql`date(${bmsScores.achievedAt}, 'unixepoch')`));
  return {
    interval: "day" as const,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    definition: BMS_STAT_DEFINITIONS.timeseries,
    series: rows,
  };
}
