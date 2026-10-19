---
cand: B2
feature: hub
kind: logic-gap
severity: low
confidence: verified
status: proposed
---

# Public stale refresh ignores Hub refresh backoff

## Problem

Cron and admin refresh write `refreshError` and `refreshBackoffUntil` (15 minutes) on failure. Cron's `isCacheEntryDue` skips a row still inside that window.

`maybeRefreshStale` does not read `refreshBackoffUntil`. On failure it only logs. `lookupCache` also ignores backoff: a row is `hit-stale` from `cachedAt` versus `hubCacheTtlMs()` alone.

While the upstream is failing, every stale hit whose single-flight slot is free starts another catalogue crawl. The 10/minute per-IP limit and `refreshCacheSingleFlight` still apply. They are not a backoff.

## Potential solution

One writer for the failure row, used by cron, admin, and the public path.

```ts
export const REFRESH_FAILURE_BACKOFF_MS = 15 * 60_000;

export async function recordRefreshFailure(rowId: number, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  await db.update(searchCache).set({
    refreshError: message.slice(0, 500),
    refreshBackoffUntil: new Date(Date.now() + REFRESH_FAILURE_BACKOFF_MS),
  }).where(eq(searchCache.id, rowId));
}
```

`maybeRefreshStale` already sits next to a loaded row. `SearchCacheMeta` includes `refreshBackoffUntil`. Skip when that timestamp is still in the future, before the rate-limit check, so a backed-off row does not consume the per-IP budget.

```ts
if (status !== "hit-stale" || refreshCacheSingleFlight.has(rowId)) return;
if (row.refreshBackoffUntil && row.refreshBackoffUntil.getTime() > Date.now()) return;
```

Pass the row in, or the timestamp. On failure, `recordRefreshFailure` instead of `console.error` alone. A log line can stay.

Cron and `admin.ts` call the same helper. Do not leave a second 15-minute literal in the admin route.

Successful `refreshCache` already clears `refreshError` and `refreshBackoffUntil`. Leave that.

## Do not

- Do not make `lookupCache` return `hit-fresh` during backoff. The page is still stale. The skip is only on starting another crawl.
- Do not remove the per-IP limit or the single-flight map.

## Touch

- `apps/hub/src/services/cache.ts` — `recordRefreshFailure`
- `apps/hub/src/services/cacheRefreshCron.ts` — use it, delete the local constant
- `apps/hub/src/routes/admin.ts` — same
- `apps/hub/src/routes/search.ts` — `maybeRefreshStale`

## Tests

- Stale row with `refreshBackoffUntil` in the future: `maybeRefreshStale` does not call `refreshCacheSingleFlight`.
- Stale row past the backoff: it does.
- A rejected refresh writes `refreshBackoffUntil` about 15 minutes out and a truncated `refreshError`.
