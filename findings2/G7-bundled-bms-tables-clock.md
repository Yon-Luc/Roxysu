---
cand: G7
feature: bms
kind: logic-gap
severity: low
confidence: verified
status: proposed
---

# Bundled BMS tables are stamped with the local clock

## Problem

`seedBundledLocalTables` inserts with `importedAt = Date.now()`. `localTableCompletion` keeps the greatest `importedAt` per `tableId`.

`replaceTableCache` is `onConflictDoNothing()`, so a later process start does not re-stamp an existing row. Hub refresh keeps the Hub timestamp: `Date.parse(version.importedAt)`.

The first writeup said a Hub version imported earlier never wins. That is too broad. Competition is per `tableId`, which is `sha256(sourceUrl)`. Bundled rows use `bundled://bms-tables/<file>`. A stellabms.xyz import is a different id and is still listed. A later Hub import of the same id, with a later `importedAt`, does win.

The real case is the Hub's own bundled seed, which shares that `tableId`. A client boot stamped `Date.now()` outranks a Hub import whose `importedAt` is earlier than that boot. An already-seeded row keeps that stamp forever, because conflict does nothing.

## Potential solution

Stamp bundled rows with `0`, not the clock. Any real Hub import has a positive `importedAt` and wins. Offline, the bundled row is still the only row for that id, so completion still works.

`onConflictDoNothing` will not repair rows already stamped. Follow the seed with an update for bundled source urls only:

```ts
await db.update(bmsTableCache)
  .set({ importedAt: new Date(0) })
  .where(like(bmsTableCache.sourceUrl, "bundled://%"));
```

Do that even when `bundledTablesSeeded` is already true for this process, or the update never runs on a warm server. The in-memory flag can still skip the insert loop. The update is cheap and idempotent.

Do not change the `orderBy(desc(importedAt))` pick. With stamp `0`, the order already prefers a Hub row of the same id. Preferring `source = hub` in the sort would also work and is unnecessary if the stamp is fixed.

## Do not

- Do not stamp with a build-time `Date.now()` baked into the bundle. That is the same bug, frozen.
- Do not delete Hub rows to let the bundle win. The Hub row is the newer catalogue when its timestamp says so.

## Touch

- `apps/server/src/bms/localProfile.ts` — `seedBundledLocalTables`
- the `bmsTableCache` import already used there

## Tests

Seed a bundled row, insert a same-`tableId` Hub row with `importedAt` of yesterday, call the seed again, assert `localTableCompletion` uses the Hub row. A second case with no Hub row still returns the bundled entries.
