import { and, eq, inArray } from "drizzle-orm";
import { beatmapSets, beatmaps } from "@roxysu/db/schema";

import type { Db } from "../db-runtime";
import {
  normalizeOnlineBeatmapSet,
  type OnlineBeatmapDifficulty,
  type OnlineBeatmapSet,
} from "./search";
import { MIRROR_USER_AGENT } from "./userAgent";

const INFO_TIMEOUT_MS = 12_000;
const FETCH_CONCURRENCY = 8;
const MAX_BATCH = 100;

const STATUS_FROM_INT: Record<number, string> = {
  [-2]: "graveyard",
  [-1]: "wip",
  0: "pending",
  1: "ranked",
  2: "approved",
  3: "qualified",
  4: "loved",
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function rulesetToMode(shortName: string | null | undefined): {
  mode: string;
  modeInt: number;
} {
  switch (shortName) {
    case "taiko":
      return { mode: "taiko", modeInt: 1 };
    case "fruits":
      return { mode: "fruits", modeInt: 2 };
    case "mania":
      return { mode: "mania", modeInt: 3 };
    default:
      return { mode: "osu", modeInt: 0 };
  }
}

/** Build card payloads from maps already in the local Roxysu library. */
export async function loadLocalBeatmapsetInfo(
  db: Db,
  setIds: number[],
): Promise<Map<number, OnlineBeatmapSet>> {
  const out = new Map<number, OnlineBeatmapSet>();
  if (setIds.length === 0) return out;

  const rows = await db
    .select({
      setOnlineId: beatmapSets.onlineId,
      setStatus: beatmapSets.status,
      beatmapOnlineId: beatmaps.onlineId,
      difficultyName: beatmaps.difficultyName,
      starRating: beatmaps.starRating,
      rulesetShortName: beatmaps.rulesetShortName,
      circleSize: beatmaps.circleSize,
      length: beatmaps.length,
      bpm: beatmaps.bpm,
      title: beatmaps.title,
      artist: beatmaps.artist,
      mapperUsername: beatmaps.mapperUsername,
    })
    .from(beatmaps)
    .innerJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
    .where(
      and(
        inArray(beatmapSets.onlineId, setIds),
        eq(beatmapSets.deletePending, false),
      ),
    );

  const bySet = new Map<number, typeof rows>();
  for (const row of rows) {
    if (row.setOnlineId <= 0) continue;
    const list = bySet.get(row.setOnlineId) ?? [];
    list.push(row);
    bySet.set(row.setOnlineId, list);
  }

  for (const [setId, diffs] of bySet) {
    const first = diffs[0]!;
    const beatmapRows: OnlineBeatmapDifficulty[] = diffs
      .map((d) => {
        const { mode, modeInt } = rulesetToMode(d.rulesetShortName);
        // Local DB stores lazer Length in milliseconds; OnlineBeatmapSet uses seconds.
        const lengthSeconds =
          d.length != null && Number.isFinite(d.length) && d.length > 0
            ? Math.max(1, Math.round(d.length / 1000))
            : null;
        return {
          id: d.beatmapOnlineId,
          version: d.difficultyName ?? "Unknown",
          stars: d.starRating ?? 0,
          mode,
          modeInt,
          keys:
            modeInt === 3 && d.circleSize != null
              ? Math.round(d.circleSize)
              : null,
          totalLength: lengthSeconds,
        };
      })
      .sort((a, b) => a.stars - b.stars);

    let lengthSeconds: number | null = null;
    let bpm: number | null = null;
    for (const d of beatmapRows) {
      if (d.totalLength != null && d.totalLength > 0) {
        lengthSeconds =
          lengthSeconds == null
            ? d.totalLength
            : Math.max(lengthSeconds, d.totalLength);
      }
    }
    for (const d of diffs) {
      if (d.bpm != null && Number.isFinite(d.bpm) && d.bpm > 0) {
        bpm = d.bpm;
        break;
      }
    }

    out.set(setId, {
      id: setId,
      artist: first.artist ?? "Unknown",
      title: first.title ?? "Untitled",
      creator: first.mapperUsername ?? "Unknown",
      status: STATUS_FROM_INT[first.setStatus] ?? "unknown",
      bpm,
      favouriteCount: 0,
      playCount: 0,
      hasVideo: false,
      rankedDate: null,
      lengthSeconds,
      beatmaps: beatmapRows,
    });
  }

  return out;
}

/** Fetch one set from hinai's beatmap-info API (osu!-shaped `/s/{id}`). */
export async function fetchHinaiBeatmapsetInfo(
  setId: number,
): Promise<OnlineBeatmapSet | null> {
  if (!Number.isSafeInteger(setId) || setId <= 0) return null;
  const url = `https://mirror.hinamizawa.ai/v3/osu/beatmaps/s/${setId}`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": MIRROR_USER_AGENT,
      },
      signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const payload: unknown = await res.json();
    return normalizeOnlineBeatmapSet(payload);
  } catch {
    return null;
  }
}

/**
 * Resolve card metadata for many set IDs: prefer local library, fill gaps
 * from hinai beatmap-info. Preserves input order; skips unresolved IDs.
 */
export async function resolveBeatmapsetInfoBatch(
  db: Db,
  setIds: number[],
): Promise<{ items: OnlineBeatmapSet[]; missing: number[] }> {
  const unique = [
    ...new Set(
      setIds.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, MAX_BATCH),
    ),
  ];
  const local = await loadLocalBeatmapsetInfo(db, unique);
  const needRemote = unique.filter((id) => !local.has(id));

  const remote = new Map<number, OnlineBeatmapSet>();
  for (const batch of chunk(needRemote, FETCH_CONCURRENCY * 2)) {
    const fetched = await mapPool(batch, FETCH_CONCURRENCY, async (id) => {
      const set = await fetchHinaiBeatmapsetInfo(id);
      return set ? ([id, set] as const) : null;
    });
    for (const row of fetched) {
      if (!row) continue;
      remote.set(row[0], row[1]);
    }
  }

  const items: OnlineBeatmapSet[] = [];
  const missing: number[] = [];
  for (const id of unique) {
    const set = local.get(id) ?? remote.get(id);
    if (set) items.push(set);
    else missing.push(id);
  }
  return { items, missing };
}
