import { beatmapSets } from "@roxysu/db/schema";
import { and, eq, gt } from "drizzle-orm";

import type { Db } from "../db-runtime";
import { getActiveBeatmapMirrorProvider } from "./providers";
import {
  buildMirrorSearchUrl,
  extractSearchBeatmapsets,
  normalizeMirrorSearchResult,
  type MirrorSearchParams,
  type OnlineBeatmapSet,
} from "./search";

export async function loadOwnedSetOnlineIds(db: Db): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ onlineId: beatmapSets.onlineId })
    .from(beatmapSets)
    .where(
      and(gt(beatmapSets.onlineId, 0), eq(beatmapSets.deletePending, false)),
    );
  return new Set(rows.map((row) => row.onlineId));
}

export type MirrorSearchResult = {
  provider: string;
  page: number;
  excludeOwned: boolean;
  ownedSkipped: number;
  mirrorCount: number;
  hasMore: boolean;
  items: OnlineBeatmapSet[];
  note: string;
};

const MIRROR_FETCH_TIMEOUT_MS = 20_000;
/** Nerinyan / osu.direct typically return up to this many sets per page. */
const MIRROR_PAGE_CAPACITY = 50;

export async function searchOnlineBeatmapsets(
  db: Db,
  params: MirrorSearchParams & {
    excludeOwned?: boolean;
  },
): Promise<MirrorSearchResult> {
  const provider = getActiveBeatmapMirrorProvider();
  const page = Math.max(0, params.page ?? 0);
  const excludeOwned = params.excludeOwned !== false;

  const url = buildMirrorSearchUrl(provider.id, {
    q: params.q,
    mode: params.mode,
    status: params.status,
    sort: params.sort,
    page,
  });

  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "roxysu" },
    signal: AbortSignal.timeout(MIRROR_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(
      `Mirror search failed (${provider.label}): HTTP ${res.status}`,
    );
  }

  const payload: unknown = await res.json();
  const rawSets = extractSearchBeatmapsets(payload);
  const owned = excludeOwned
    ? await loadOwnedSetOnlineIds(db)
    : new Set<number>();

  const items: OnlineBeatmapSet[] = [];
  let ownedSkipped = 0;

  for (const raw of rawSets) {
    const set = normalizeMirrorSearchResult(provider.id, raw);
    if (!set) continue;
    if (excludeOwned && owned.has(set.id)) {
      ownedSkipped += 1;
      continue;
    }
    items.push(set);
  }

  return {
    provider: provider.id,
    page,
    excludeOwned,
    ownedSkipped,
    mirrorCount: rawSets.length,
    hasMore: rawSets.length >= MIRROR_PAGE_CAPACITY,
    items,
    note:
      "Open or drag downloaded .osz files into osu!lazer to import. Sets already in your local library are hidden by default.",
  };
}
