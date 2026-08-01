import { subscribe } from "../shared/events";

/** Safety TTL if an invalidation event is missed. */
const TTL_MS = 10 * 60 * 1000;

type CacheEntry = {
  at: number;
  payload: unknown;
};

const cache = new Map<string, CacheEntry>();

export function playerStatsCacheKey(parts: {
  granularity: string;
  range: number;
  skillTopPlays: number;
  keyCount: number;
  /** Resolved username filter; null/omit = all. */
  username?: string | null;
  /** Resolved gamemode filter; null/omit = all. */
  gamemode?: string | null;
}): string {
  // v5: per-keymode stats + username + gamemode filter (NM + Mirror only)
  const user = parts.username ?? "*";
  const mode = parts.gamemode ?? "*";
  return `v5:${user}:${mode}:${parts.granularity}:${parts.range}:${parts.skillTopPlays}:k${parts.keyCount}`;
}

export function getCachedPlayerStats<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.payload as T;
}

export function setCachedPlayerStats(key: string, payload: unknown): void {
  cache.set(key, { at: Date.now(), payload });
}

export function invalidatePlayerStatsCache(): void {
  cache.clear();
}

function shouldInvalidate(type: string): boolean {
  return (
    type === "dashboard.updated" ||
    type === "score.imported" ||
    type === "score.updated" ||
    type === "sync.finished" ||
    type === "mastery.updated"
  );
}

subscribe((event) => {
  if (shouldInvalidate(event.type)) invalidatePlayerStatsCache();
});
