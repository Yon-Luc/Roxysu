---
cand: G5
reopens: F-062
feature: bms
kind: correctness
severity: low
confidence: verified
status: proposed
---

# BMS tables background refresh can reject unhandled

## Problem

`scheduleTableRefresh` starts a fire-and-forget IIFE. `readSetting` and `writeSetting` sit outside the `try`. The `.finally` that clears `tableRefreshInFlight` returns a new promise that rejects with the same reason. Nothing catches it. `GET` does not await it.

Fetch failures inside `refreshTableCache` are already swallowed. A throw from `readSetting` or `writeSetting` (SQLITE_BUSY after the busy timeout, for example) is not. The server has no `unhandledRejection` handler. Node's default since v15 is to throw that as an uncaught exception and exit. Desktop runs this server as Node. Opening the tables tab can take the packaged app down. F-062 added no test for this path.

## Potential solution

One try/catch around the whole body, and a catch on the promise so a future edit outside the try cannot regress it.

```ts
tableRefreshInFlight = (async () => {
  try {
    if (!force) {
      const last = Number((await readSetting(db, BMS_TABLE_REFRESH_AT_KEY)) ?? "0");
      if (Number.isFinite(last) && Date.now() - last < TABLE_REFRESH_MS) return;
    }
    await writeSetting(db, BMS_TABLE_REFRESH_AT_KEY, String(Date.now()));
    await refreshTableCache(db);
  } catch {
    // The next interval tries again. The response already used the cache.
  }
})().finally(() => {
  tableRefreshInFlight = null;
});
```

`.finally` on a caught promise fulfills. The unhandled path is gone. Keep the empty catch. This refresh must not fail the request that already returned cached tables.

Do not add a process-wide `unhandledRejection` logger as the fix. That hides the next one.

## Do not

- Do not await this from the GET handler. The point of F-062 is that the response does not wait on the refresh.
- Do not clear `tableRefreshInFlight` only in the catch. The `finally` has to run on success too, or a later refresh never starts.

## Touch

- `apps/server/src/routes/bms.ts` — `scheduleTableRefresh`

## Tests

Route test with `readSetting` throwing. The GET still returns the cached catalogue, the process is still up (the returned promise is handled), and a second GET can schedule again after the in-flight promise settles. Assert `tableRefreshInFlight` is null after a tick.
