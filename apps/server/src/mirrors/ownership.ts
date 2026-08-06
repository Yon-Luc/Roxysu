import { beatmapSets } from "@roxysu/db/schema";
import { and, eq, gt } from "drizzle-orm";

import type { Db } from "../db-runtime";

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
