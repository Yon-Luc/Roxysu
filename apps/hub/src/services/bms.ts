import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as hubSchema from "@roxysu/db/hub";
import {
  bmsCharts,
  bmsScoreSubmissions,
  bmsScores,
  bmsTableEntries,
  bmsTableVersions,
  bmsTables,
  hubUsers,
} from "@roxysu/db/hub";
import {
  BMS_AUTOPLAY_ACRONYM,
  bmsScorePresentation,
  comboLampMeets,
  gradeMeets,
  groupBmsSessions,
  isAllowedBmsTableUrl,
  isKnownVariantId,
  parseBmsTableJson,
  BMS_GAUGE_IDS,
  type BmsDjGrade,
  type BmsParsedTable,
} from "@roxysu/db/bms";
import { bundledTableIdentity, loadBundledBmsTables } from "@roxysu/db/bms-tables";

export type HubDb = BunSQLiteDatabase<typeof hubSchema>;

const MAX_BATCH = 50;
const MAX_BODY = 5_000_000;

export type BmsInbound = {
  localScoreId: string;
  rulesetId?: string;
  userId?: number;
  chart: {
    md5?: string;
    sha256?: string | null;
    title?: string | null;
    artist?: string | null;
    keyCount?: number | null;
  };
  achievedAt: string;
  score: {
    exScore?: number | null;
    maxExScore?: number | null;
    normalizedScore?: number | null;
    accuracy?: number | null;
  };
  judgements?: {
    pgreat?: number | null;
    great?: number | null;
    good?: number | null;
    bad?: number | null;
    poor?: number | null;
    miss?: number | null;
  };
  gameplay: {
    variantId: string;
    gaugeId?: string | null;
    comboLampId?: string | null;
    clearLampId?: string | null;
    djGrade?: string | null;
    mods?: string[];
  };
};

export type BmsItemResult = {
  localScoreId: string;
  status: "accepted" | "duplicate" | "rejected" | "retryable_error";
  scoreId?: string;
  reason?: string;
};

function hashPayload(score: BmsInbound): string {
  return createHash("sha256").update(JSON.stringify(score)).digest("hex");
}

function optionalCount(value: number | null | undefined, name: string): string | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
    return `${name} out of range`;
  }
  return null;
}

export function validateInbound(score: BmsInbound): string | null {
  if (!score.localScoreId || score.localScoreId.length > 80) return "invalid local score id";
  if (score.rulesetId != null && score.rulesetId !== "bms") return "unsupported ruleset";
  const md5 = score.chart?.md5?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{32}$/.test(md5)) return "invalid chart md5";
  const sha = score.chart.sha256;
  if (sha != null && sha !== "" && !/^[0-9a-f]{64}$/i.test(sha)) return "invalid chart sha256";
  const when = Date.parse(score.achievedAt);
  if (!Number.isFinite(when)) return "invalid achievedAt";
  if (when > Date.now() + 5 * 60_000) return "achievedAt is in the future";
  if (when < Date.UTC(2000, 0, 1)) return "achievedAt is too old";
  if (!isKnownVariantId(score.gameplay?.variantId ?? "")) return "unknown variant";
  const gauge = score.gameplay.gaugeId;
  if (gauge != null && gauge !== "" && !BMS_GAUGE_IDS.has(gauge)) return "unknown gauge";
  const ex = score.score?.exScore;
  if (ex != null && (!Number.isInteger(ex) || ex < 0 || ex > 10_000_000)) return "exScore out of range";
  const maxEx = score.score?.maxExScore;
  if (maxEx != null && (!Number.isInteger(maxEx) || maxEx < 0 || maxEx > 10_000_000)) {
    return "maxExScore out of range";
  }
  const normalized = score.score?.normalizedScore;
  if (normalized != null && (!Number.isInteger(normalized) || normalized < 0 || normalized > 2_000_000)) {
    return "normalizedScore out of range";
  }
  const accuracy = score.score?.accuracy;
  if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1)) {
    return "accuracy out of range";
  }
  for (const key of ["pgreat", "great", "good", "bad", "poor", "miss"] as const) {
    const reason = optionalCount(score.judgements?.[key], key);
    if (reason) return reason;
  }
  const mods = score.gameplay.mods ?? [];
  if (mods.some((mod) => mod.toUpperCase() === BMS_AUTOPLAY_ACRONYM)) return "autoplay";
  return null;
}

function presentedScore(score: BmsInbound) {
  return bmsScorePresentation({
    pgreat: score.judgements?.pgreat ?? null,
    great: score.judgements?.great ?? null,
    good: score.judgements?.good ?? null,
    bad: score.judgements?.bad ?? null,
    poor: score.judgements?.poor ?? null,
    miss: score.judgements?.miss ?? null,
    accuracy: score.score.accuracy ?? null,
  });
}

async function findScore(
  db: HubDb,
  userId: number,
  installationId: string,
  localScoreId: string,
) {
  return db
    .select({ id: bmsScores.id })
    .from(bmsScores)
    .where(
      and(
        eq(bmsScores.userId, userId),
        eq(bmsScores.installationId, installationId),
        eq(bmsScores.localScoreId, localScoreId),
      ),
    )
    .get();
}

export async function ingestBmsScore(
  db: HubDb,
  ownerId: number,
  installationId: string,
  score: BmsInbound,
): Promise<BmsItemResult> {
  const existing = await findScore(db, ownerId, installationId, score.localScoreId ?? "");
  if (existing) {
    return { localScoreId: score.localScoreId, status: "duplicate", scoreId: existing.id };
  }
  const prior = await db
    .select({ status: bmsScoreSubmissions.status })
    .from(bmsScoreSubmissions)
    .where(
      and(
        eq(bmsScoreSubmissions.userId, ownerId),
        eq(bmsScoreSubmissions.installationId, installationId),
        eq(bmsScoreSubmissions.localScoreId, score.localScoreId),
      ),
    )
    .get();
  if (prior?.status === "rejected") {
    return {
      localScoreId: score.localScoreId,
      status: "rejected",
      reason: "previously rejected",
    };
  }

  const reason = validateInbound(score);
  if (reason) {
    await db
      .insert(bmsScoreSubmissions)
      .values({
        userId: ownerId,
        installationId,
        localScoreId: score.localScoreId || "invalid",
        payloadHash: hashPayload(score),
        status: "rejected",
      })
      .onConflictDoNothing();
    return { localScoreId: score.localScoreId, status: "rejected", reason };
  }

  const md5 = score.chart.md5!.toLowerCase();
  const presented = presentedScore(score);
  const scoreId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(bmsCharts)
        .values({
          md5,
          sha256: score.chart.sha256?.toLowerCase() ?? null,
          title: score.chart.title ?? null,
          artist: score.chart.artist ?? null,
          keyCount: score.chart.keyCount ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: bmsCharts.md5,
          set: {
            ...(score.chart.sha256 ? { sha256: score.chart.sha256.toLowerCase() } : {}),
            ...(score.chart.title ? { title: score.chart.title } : {}),
            ...(score.chart.artist ? { artist: score.chart.artist } : {}),
            ...(score.chart.keyCount != null ? { keyCount: score.chart.keyCount } : {}),
            updatedAt: new Date(),
          },
        });
      await tx.insert(bmsScores).values({
        id: scoreId,
        userId: ownerId,
        installationId,
        localScoreId: score.localScoreId,
        chartMd5: md5,
        achievedAt: new Date(score.achievedAt),
        exScore: score.score.exScore ?? null,
        maxExScore: score.score.maxExScore ?? null,
        normalizedScore: score.score.normalizedScore ?? null,
        accuracy: score.score.accuracy ?? null,
        pgreat: score.judgements?.pgreat ?? null,
        great: score.judgements?.great ?? null,
        good: score.judgements?.good ?? null,
        bad: score.judgements?.bad ?? null,
        poor: score.judgements?.poor ?? null,
        miss: score.judgements?.miss ?? null,
        variantId: score.gameplay.variantId,
        gaugeId: score.gameplay.gaugeId ?? null,
        comboLampId: presented.comboLampId,
        clearLampId: null,
        djGrade: presented.djGrade,
        modsJson: JSON.stringify(score.gameplay.mods ?? []),
        trust: "community_submitted",
      });
      await tx.insert(bmsScoreSubmissions).values({
        userId: ownerId,
        installationId,
        localScoreId: score.localScoreId,
        scoreId,
        payloadHash: hashPayload(score),
        status: "accepted",
      });
    });
  } catch (err) {
    const again = await findScore(db, ownerId, installationId, score.localScoreId);
    if (again) {
      return { localScoreId: score.localScoreId, status: "duplicate", scoreId: again.id };
    }
    return {
      localScoreId: score.localScoreId,
      status: "retryable_error",
      reason: err instanceof Error ? err.message : "insert failed",
    };
  }
  return { localScoreId: score.localScoreId, status: "accepted", scoreId };
}

export async function ingestBmsBatch(
  db: HubDb,
  ownerId: number,
  installationId: string,
  scores: BmsInbound[],
): Promise<{ error?: string; results: BmsItemResult[] }> {
  if (!installationId || installationId.length > 80) {
    return { error: "invalid installation id", results: [] };
  }
  if (scores.length === 0 || scores.length > MAX_BATCH) {
    return { error: `batch size must be 1..${MAX_BATCH}`, results: [] };
  }
  const results: BmsItemResult[] = [];
  for (const score of scores) {
    results.push(await ingestBmsScore(db, ownerId, installationId, score));
  }
  return { results };
}

async function userByName(db: HubDb, username: string) {
  return db
    .select()
    .from(hubUsers)
    .where(sql`lower(${hubUsers.username}) = ${username.toLowerCase()}`)
    .get();
}

export async function readBmsProfile(
  db: HubDb,
  username: string,
  viewerId: number | null,
) {
  const user = await userByName(db, username);
  if (!user) return null;
  if (!user.bmsProfilePublic && viewerId !== user.id) return null;
  const variants = await db
    .select({
      variantId: bmsScores.variantId,
      plays: sql<number>`count(*)`.mapWith(Number),
    })
    .from(bmsScores)
    .where(eq(bmsScores.userId, user.id))
    .groupBy(bmsScores.variantId)
    .orderBy(desc(sql`count(*)`));
  const [summary] = await db
    .select({
      plays: sql<number>`count(*)`.mapWith(Number),
      latest: sql<number | null>`max(${bmsScores.achievedAt})`,
    })
    .from(bmsScores)
    .where(eq(bmsScores.userId, user.id));
  return {
    username: user.username,
    osuId: user.osuId,
    avatarUrl: user.avatarUrl,
    countryCode: user.countryCode,
    profilePublic: user.bmsProfilePublic,
    plays: summary?.plays ?? 0,
    latestPlayedAt: summary?.latest ?? null,
    variants,
  };
}

export async function listProfileScores(
  db: HubDb,
  username: string,
  viewerId: number | null,
  input: { variant: string | null; limit: number; cursor?: string | null },
) {
  const user = await userByName(db, username);
  if (!user || (!user.bmsProfilePublic && viewerId !== user.id)) return null;
  const filters = [eq(bmsScores.userId, user.id)];
  if (input.variant) filters.push(eq(bmsScores.variantId, input.variant));
  if (input.cursor) {
    const [seconds, id] = input.cursor.split("|");
    const when = Number(seconds);
    if (Number.isFinite(when) && id) {
      filters.push(
        sql`(${bmsScores.achievedAt} < ${when} OR (${bmsScores.achievedAt} = ${when} AND ${bmsScores.id} < ${id}))`,
      );
    }
  }
  const limit = Math.min(50, Math.max(1, input.limit));
  const rows = await db
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
    })
    .from(bmsScores)
    .innerJoin(bmsCharts, eq(bmsCharts.md5, bmsScores.chartMd5))
    .where(and(...filters))
    .orderBy(desc(bmsScores.achievedAt), desc(bmsScores.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const lastAt = last ? Math.floor(new Date(last.achievedAt).getTime() / 1000) : 0;
  return {
    scores: page.map((row) => ({
      ...row,
      achievedAt: new Date(row.achievedAt).toISOString(),
    })),
    nextCursor: rows.length > limit && last ? `${lastAt}|${last.id}` : null,
  };
}

export async function profileStats(db: HubDb, username: string, viewerId: number | null, variant: string) {
  const user = await userByName(db, username);
  if (!user || (!user.bmsProfilePublic && viewerId !== user.id)) return null;
  const [row] = await db
    .select({
      plays: sql<number>`count(*)`.mapWith(Number),
      bestEx: sql<number | null>`max(${bmsScores.exScore})`,
    })
    .from(bmsScores)
    .where(and(eq(bmsScores.userId, user.id), eq(bmsScores.variantId, variant)));
  const grades = await db
    .select({
      djGrade: bmsScores.djGrade,
      plays: sql<number>`count(*)`.mapWith(Number),
    })
    .from(bmsScores)
    .where(and(eq(bmsScores.userId, user.id), eq(bmsScores.variantId, variant)))
    .groupBy(bmsScores.djGrade);
  return { variantId: variant, plays: row?.plays ?? 0, bestEx: row?.bestEx ?? null, grades };
}

export async function profileSessions(
  db: HubDb,
  username: string,
  viewerId: number | null,
  variant: string | null,
) {
  const user = await userByName(db, username);
  if (!user || (!user.bmsProfilePublic && viewerId !== user.id)) return null;
  const filters = [eq(bmsScores.userId, user.id)];
  if (variant) filters.push(eq(bmsScores.variantId, variant));
  const rows = await db
    .select({
      id: bmsScores.id,
      playedAt: bmsScores.achievedAt,
      exScore: bmsScores.exScore,
      normalizedScore: bmsScores.normalizedScore,
      title: bmsCharts.title,
    })
    .from(bmsScores)
    .innerJoin(bmsCharts, eq(bmsCharts.md5, bmsScores.chartMd5))
    .where(and(...filters))
    .orderBy(desc(bmsScores.achievedAt))
    .limit(400);
  const grouped = groupBmsSessions(
    rows.map((row) => ({
      id: row.id,
      playedAt: new Date(row.playedAt).getTime(),
      exScore: row.exScore,
      normalizedScore: row.normalizedScore ?? 0,
      title: row.title,
    })),
  );
  return {
    sessions: grouped.slice(0, 20).map((session) => ({
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: new Date(session.endedAt).toISOString(),
      scoreCount: session.scoreCount,
      titles: session.scores
        .map((score) => score.title)
        .filter((title): title is string => !!title)
        .slice(0, 3),
    })),
  };
}

export async function profileActivity(db: HubDb, username: string, viewerId: number | null) {
  const user = await userByName(db, username);
  if (!user || (!user.bmsProfilePublic && viewerId !== user.id)) return null;
  const rows = await db
    .select({
      day: sql<string>`date(${bmsScores.achievedAt}, 'unixepoch')`,
      plays: sql<number>`count(*)`.mapWith(Number),
    })
    .from(bmsScores)
    .where(eq(bmsScores.userId, user.id))
    .groupBy(sql`date(${bmsScores.achievedAt}, 'unixepoch')`)
    .orderBy(asc(sql`date(${bmsScores.achievedAt}, 'unixepoch')`));
  return { days: rows };
}

function scoreMeets(row: { djGrade: string | null; comboLampId: string | null }, achievement: string) {
  if (achievement === "fc" || achievement === "perfect" || achievement === "max-lamp") {
    const minimum = achievement === "max-lamp" ? "max" : achievement;
    return comboLampMeets(row.comboLampId, minimum);
  }
  return gradeMeets(row.djGrade, achievement as BmsDjGrade);
}

export async function tableCompletion(
  db: HubDb,
  username: string,
  viewerId: number | null,
  tableId: string,
  versionId: string | null,
  variant: string,
  achievement: string,
) {
  const user = await userByName(db, username);
  if (!user || (!user.bmsProfilePublic && viewerId !== user.id)) return null;
  const version = versionId
    ? await db.select().from(bmsTableVersions).where(eq(bmsTableVersions.id, versionId)).get()
    : await db
        .select()
        .from(bmsTableVersions)
        .where(eq(bmsTableVersions.tableId, tableId))
        .orderBy(desc(bmsTableVersions.importedAt))
        .limit(1)
        .get();
  if (!version || version.tableId !== tableId) return null;
  const table = await db.select().from(bmsTables).where(eq(bmsTables.id, tableId)).get();
  if (!table) return null;
  const played = await db
    .select({
      md5: bmsScores.chartMd5,
      sha256: bmsCharts.sha256,
      djGrade: bmsScores.djGrade,
      comboLampId: bmsScores.comboLampId,
    })
    .from(bmsScores)
    .leftJoin(bmsCharts, eq(bmsCharts.md5, bmsScores.chartMd5))
    .where(and(eq(bmsScores.userId, user.id), eq(bmsScores.variantId, variant)));
  const hits = new Set<string>();
  for (const row of played) {
    if (!scoreMeets(row, achievement)) continue;
    hits.add(row.md5.toLowerCase());
    if (row.sha256) hits.add(row.sha256.toLowerCase());
  }
  const entries = await db
    .select()
    .from(bmsTableEntries)
    .where(eq(bmsTableEntries.versionId, version.id));
  const levels = new Map<
    string,
    {
      level: string;
      levelIndex: number;
      total: number;
      cleared: number;
      songs: Array<{ title: string | null; artist: string | null; md5: string | null; cleared: boolean }>;
    }
  >();
  for (const entry of entries) {
    const bucket = levels.get(entry.level) ?? {
      level: entry.level,
      levelIndex: entry.levelIndex,
      total: 0,
      cleared: 0,
      songs: [],
    };
    const hashes = [entry.chartHash, entry.sha256].filter((hash): hash is string => !!hash);
    const cleared = hashes.some((hash) => hits.has(hash.toLowerCase()));
    bucket.total += 1;
    if (cleared) bucket.cleared += 1;
    bucket.songs.push({
      title: entry.title,
      artist: entry.artist,
      md5: entry.hashKind === "md5" ? entry.chartHash : null,
      cleared,
    });
    levels.set(entry.level, bucket);
  }
  const rows = [...levels.values()]
    .sort((a, b) => a.levelIndex - b.levelIndex)
    .map((level) => ({
      ...level,
      songs: level.songs.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")),
    }));
  return {
    tableId,
    versionId: version.id,
    name: table.name,
    symbol: table.symbol,
    achievement,
    variantId: variant,
    unresolvedCount: version.unresolvedCount,
    levels: rows,
  };
}

export async function listTables(db: HubDb) {
  const tables = await db.select().from(bmsTables).orderBy(asc(bmsTables.name));
  const versions = await db
    .select()
    .from(bmsTableVersions)
    .orderBy(desc(bmsTableVersions.importedAt));
  return {
    tables: tables.map((table) => {
      const latest = versions.find((version) => version.tableId === table.id) ?? null;
      return {
        id: table.id,
        name: table.name,
        symbol: table.symbol,
        sourceUrl: table.sourceUrl,
        latestVersionId: latest?.id ?? null,
        importedAt: latest ? new Date(latest.importedAt).toISOString() : null,
      };
    }),
  };
}

export async function readTableVersion(db: HubDb, tableId: string, versionId: string) {
  const version = await db
    .select()
    .from(bmsTableVersions)
    .where(eq(bmsTableVersions.id, versionId))
    .get();
  if (!version || version.tableId !== tableId) return null;
  const table = await db.select().from(bmsTables).where(eq(bmsTables.id, tableId)).get();
  if (!table) return null;
  const entries = await db
    .select()
    .from(bmsTableEntries)
    .where(eq(bmsTableEntries.versionId, versionId))
    .orderBy(asc(bmsTableEntries.levelIndex));
  return {
    versionId: version.id,
    tableId,
    name: table.name,
    symbol: table.symbol,
    sourceUrl: version.sourceUrl,
    importedAt: new Date(version.importedAt).toISOString(),
    levelOrder: JSON.parse(version.levelOrderJson) as string[],
    unresolvedCount: version.unresolvedCount,
    entries: entries.map((entry) => ({
      level: entry.level,
      levelIndex: entry.levelIndex,
      md5: entry.hashKind === "md5" ? entry.chartHash : null,
      sha256: entry.sha256 ?? (entry.hashKind === "sha256" ? entry.chartHash : null),
      title: entry.title,
      artist: entry.artist,
    })),
  };
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > MAX_BODY) throw new Error("payload too large");
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel();
      throw new Error("payload too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchTableText(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  if (!isAllowedBmsTableUrl(url)) throw new Error("table URL is not allowed");
  const res = await fetchImpl(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json, text/html" },
  });
  if (res.status >= 300 && res.status < 400) throw new Error("redirects are not followed");
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return readLimited(res);
}

function sameHost(a: string, b: string): boolean {
  return new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase();
}

export async function importTable(
  db: HubDb,
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  const headerText = await fetchTableText(sourceUrl, fetchImpl);
  let parsed = parseBmsTableJson(headerText, new URL(sourceUrl).pathname);
  if (!parsed) throw new Error("unrecognized table");
  if (parsed.entries.length === 0 && parsed.dataUrl) {
    const dataUrl = new URL(parsed.dataUrl, sourceUrl).toString();
    if (!sameHost(sourceUrl, dataUrl) || !isAllowedBmsTableUrl(dataUrl)) {
      throw new Error("table data URL is not allowed");
    }
    const dataText = await fetchTableText(dataUrl, fetchImpl);
    const data = parseBmsTableJson(dataText, parsed.name);
    if (!data || data.entries.length === 0) throw new Error("table has no charts");
    parsed = {
      ...parsed,
      entries: data.entries,
      unresolvedCount: data.unresolvedCount,
      levelOrder: parsed.levelOrder.length > 0 ? parsed.levelOrder : data.levelOrder,
    };
  }
  if (parsed.entries.length === 0) throw new Error("table has no charts");
  return storeTable(db, sourceUrl, parsed);
}

export async function seedBundledBmsTables(db: HubDb) {
  const tables = loadBundledBmsTables();
  const stored = [];
  for (const table of tables) {
    stored.push(await storeTable(db, table.sourceUrl, table.parsed));
  }
  return stored;
}

async function storeTable(db: HubDb, sourceUrl: string, parsed: BmsParsedTable) {
  const { tableId, versionId } = bundledTableIdentity(sourceUrl, parsed);
  await db
    .insert(bmsTables)
    .values({
      id: tableId,
      name: parsed.name,
      symbol: parsed.symbol,
      sourceUrl,
    })
    .onConflictDoUpdate({
      target: bmsTables.id,
      set: { name: parsed.name, symbol: parsed.symbol, sourceUrl },
    });
  const existing = await db
    .select({ id: bmsTableVersions.id })
    .from(bmsTableVersions)
    .where(eq(bmsTableVersions.id, versionId))
    .get();
  if (!existing) {
    await db.transaction(async (tx) => {
      await tx.insert(bmsTableVersions).values({
        id: versionId,
        tableId,
        sourceUrl,
        levelOrderJson: JSON.stringify(parsed.levelOrder),
        unresolvedCount: parsed.unresolvedCount,
      });
      for (const entry of parsed.entries) {
        const chartHash = entry.md5 ?? entry.sha256;
        if (!chartHash) continue;
        await tx
          .insert(bmsTableEntries)
          .values({
            versionId,
            chartHash,
            hashKind: entry.md5 ? "md5" : "sha256",
            sha256: entry.sha256,
            level: entry.level,
            levelIndex: entry.levelIndex,
            title: entry.title,
            artist: entry.artist,
          })
          .onConflictDoNothing();
      }
    });
  }
  return {
    tableId,
    versionId,
    name: parsed.name,
    entries: parsed.entries.length,
    unresolvedCount: parsed.unresolvedCount,
    duplicate: !!existing,
  };
}

export { comboLampMeets };
