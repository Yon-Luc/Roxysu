import { beatmapSets, beatmaps } from "@roxysu/db/schema";
import { and, asc, eq, gt, gte, inArray, lte, sql, type SQL } from "drizzle-orm";

import type { Db } from "../db-runtime";
import { BEATMAP_STATUS } from "../query-language/status";
import type { MirrorSearchParams } from "./search";

/**
 * Every beatmapset online ID currently in the local library (lazer-synced,
 * not pending deletion). This is the "what do we already have" side of the
 * diff, and it is intentionally provider-agnostic: it does not know or care
 * whether a candidate ID came from nerinyan, osu.direct, hinai, or a pasted
 * list — that keeps this module reusable no matter which mirror is active.
 */
export async function loadOwnedSetOnlineIds(db: Db): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ onlineId: beatmapSets.onlineId })
    .from(beatmapSets)
    .where(
      and(gt(beatmapSets.onlineId, 0), eq(beatmapSets.deletePending, false)),
    );
  return new Set(rows.map((row) => row.onlineId));
}

/**
 * Max candidate ids accepted by one ownership diff or one `setIds` batch
 * download. Shared by `POST /mirrors/ownership/diff` and
 * `POST /mirrors/batch/start` so both have the same predictable upper cost.
 */
export const MAX_OWNERSHIP_DIFF_IDS = 20_000;

/** Default / maximum page size for `GET /mirrors/owned-set-ids`. */
export const OWNED_SET_IDS_DEFAULT_LIMIT = 20_000;
export const OWNED_SET_IDS_MAX_LIMIT = 50_000;

export type OwnedSetIdsPage = {
  /** Ascending owned beatmapset online IDs, all greater than the `after` cursor. */
  setIds: number[];
  /** Pass as `after` to fetch the next page; null when this is the last page. */
  nextAfter: number | null;
};

/**
 * One keyset page of owned beatmapset online IDs (ascending, `> after`).
 * Bounds memory per request; clients walk `nextAfter` until it is null.
 */
export async function loadOwnedSetOnlineIdsPage(
  db: Db,
  opts: { after?: number; limit?: number } = {},
): Promise<OwnedSetIdsPage> {
  const after = Number.isFinite(opts.after) ? Math.max(0, opts.after!) : 0;
  const limit = Math.min(
    OWNED_SET_IDS_MAX_LIMIT,
    Math.max(1, Math.floor(opts.limit ?? OWNED_SET_IDS_DEFAULT_LIMIT)),
  );
  const rows = await db
    .selectDistinct({ onlineId: beatmapSets.onlineId })
    .from(beatmapSets)
    .where(
      and(
        gt(beatmapSets.onlineId, after),
        eq(beatmapSets.deletePending, false),
      ),
    )
    .orderBy(asc(beatmapSets.onlineId))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).map(
    (row) => row.onlineId,
  );
  return {
    setIds: page,
    nextAfter: hasMore ? (page[page.length - 1] ?? null) : null,
  };
}

/**
 * Cheap fingerprint of the owned id set (row count, id sum, max id) so clients
 * can skip re-downloading when nothing changed. Aggregates in SQLite; does not
 * materialise the ids.
 */
export async function loadOwnedSetIdsVersion(db: Db): Promise<string> {
  const rows = await db
    .select({
      count: sql<number>`count(*)`,
      sum: sql<number>`coalesce(sum(${beatmapSets.onlineId}), 0)`,
      max: sql<number>`coalesce(max(${beatmapSets.onlineId}), 0)`,
    })
    .from(beatmapSets)
    .where(
      and(gt(beatmapSets.onlineId, 0), eq(beatmapSets.deletePending, false)),
    );
  const row = rows[0];
  return `${Number(row?.count ?? 0)}-${Number(row?.sum ?? 0)}-${Number(row?.max ?? 0)}`;
}

export type BeatmapsetOwnershipDiff = {
  /** Candidate IDs already present in the local library. */
  owned: number[];
  /** Candidate IDs not found locally — the download queue. */
  missing: number[];
};

/**
 * Pure set diff: which candidate beatmapset online IDs are already owned
 * vs. missing. Kept separate from any fetch/search call so it can be unit
 * tested without a network or DB round trip, and reused wherever a list of
 * candidate IDs turns up (mirror search results, a bulk catalog check, a
 * pasted ID list, etc).
 */
export function diffBeatmapsetIds(
  candidateIds: Iterable<number>,
  ownedIds: ReadonlySet<number>,
): BeatmapsetOwnershipDiff {
  const owned: number[] = [];
  const missing: number[] = [];
  const seen = new Set<number>();

  for (const id of candidateIds) {
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    (ownedIds.has(id) ? owned : missing).push(id);
  }

  return { owned, missing };
}

/**
 * Convenience wrapper: load the current owned set from SQLite and diff it
 * against a caller-supplied list of candidate online IDs in one call.
 */
export async function diffAgainstLibrary(
  db: Db,
  candidateIds: Iterable<number>,
): Promise<BeatmapsetOwnershipDiff> {
  const owned = await loadOwnedSetOnlineIds(db);
  return diffBeatmapsetIds(candidateIds, owned);
}

/**
 * Map mirror status filter → lazer BeatmapOnlineStatus ints on beatmap_sets.
 * Mirror `ranked` includes approved (hinai has no separate approved filter).
 * Returns null when status is absent/`any` (no status predicate).
 */
export function mirrorStatusToLocalInts(
  status: MirrorSearchParams["status"],
): number[] | null {
  if (!status || status === "any") return null;
  switch (status) {
    case "ranked":
      return [BEATMAP_STATUS.ranked, BEATMAP_STATUS.approved];
    case "loved":
      return [BEATMAP_STATUS.loved];
    case "qualified":
      return [BEATMAP_STATUS.qualified];
    case "pending":
      return [BEATMAP_STATUS.pending];
    case "graveyard":
      return [BEATMAP_STATUS.graveyard];
    default:
      return null;
  }
}

function needsBeatmapJoin(params: MirrorSearchParams): boolean {
  if (params.mode && params.mode !== "any") return true;
  if (params.minStars != null || params.maxStars != null) return true;
  if (params.minBpm != null || params.maxBpm != null) return true;
  if (params.minLength != null || params.maxLength != null) return true;
  if (params.creator?.trim()) return true;
  return false;
}

/**
 * Count distinct owned beatmapset online IDs that would match a mirror search
 * (mode / status / optional star·bpm·length·creator bounds). Used by the
 * hinai total_count fast path so "count missing" can subtract owned without
 * crawling every mirror page.
 */
export async function countOwnedSetsMatchingMirrorParams(
  db: Db,
  params: MirrorSearchParams,
): Promise<number> {
  const setConditions: SQL[] = [
    gt(beatmapSets.onlineId, 0),
    eq(beatmapSets.deletePending, false),
  ];

  const statuses = mirrorStatusToLocalInts(params.status);
  if (statuses) {
    setConditions.push(inArray(beatmapSets.status, statuses));
  }

  if (!needsBeatmapJoin(params)) {
    const rows = await db
      .select({
        count: sql<number>`count(distinct ${beatmapSets.onlineId})`,
      })
      .from(beatmapSets)
      .where(and(...setConditions));
    return Number(rows[0]?.count ?? 0);
  }

  const beatmapConditions: SQL[] = [...setConditions];

  if (params.mode && params.mode !== "any") {
    beatmapConditions.push(
      sql`lower(${beatmaps.rulesetShortName}) = ${params.mode}`,
    );
  }
  if (params.minStars != null && Number.isFinite(params.minStars)) {
    beatmapConditions.push(gte(beatmaps.starRating, params.minStars));
  }
  if (params.maxStars != null && Number.isFinite(params.maxStars)) {
    beatmapConditions.push(lte(beatmaps.starRating, params.maxStars));
  }
  if (params.minBpm != null && Number.isFinite(params.minBpm)) {
    beatmapConditions.push(gte(beatmaps.bpm, params.minBpm));
  }
  if (params.maxBpm != null && Number.isFinite(params.maxBpm)) {
    beatmapConditions.push(lte(beatmaps.bpm, params.maxBpm));
  }
  if (params.minLength != null && Number.isFinite(params.minLength)) {
    beatmapConditions.push(gte(beatmaps.length, params.minLength));
  }
  if (params.maxLength != null && Number.isFinite(params.maxLength)) {
    beatmapConditions.push(lte(beatmaps.length, params.maxLength));
  }
  const creator = params.creator?.trim();
  if (creator) {
    beatmapConditions.push(
      sql`lower(${beatmaps.mapperUsername}) = lower(${creator})`,
    );
  }

  const rows = await db
    .select({
      count: sql<number>`count(distinct ${beatmapSets.onlineId})`,
    })
    .from(beatmapSets)
    .innerJoin(beatmaps, eq(beatmaps.setId, beatmapSets.id))
    .where(and(...beatmapConditions));

  return Number(rows[0]?.count ?? 0);
}
