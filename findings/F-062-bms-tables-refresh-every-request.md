---
id: F-062
feature: bms
kind: perf
severity: medium
confidence: verified
---

# Every BMS tables request refreshes the Hub catalogue first

## What

`GET /api/bms/tables` always calls `refreshTableCache` before reading SQLite. That function fetches the catalogue and then one version document per table. Failures are swallowed so the last cache can still render, after the fetches time out.

## Why

Browsing the tables tab repeats the Hub round-trips. Offline, the handler waits on those failures before it shows the cache it already had.

## How to improve

Serve the SQLite cache immediately. Refresh in the background on a TTL, or when the client passes `?refresh=1`.

## Potential gain

The tables tab opens from disk. Hub load drops to the refresh interval.

## Evidence

- `apps/server/src/routes/bms.ts` `refreshTableCache` (lines 35–72) and the `/tables` handler (lines 151–157): `await refreshTableCache(db)` inside try/catch on every request.
