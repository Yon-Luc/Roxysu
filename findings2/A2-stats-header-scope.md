---
cand: A2
reopens: F-016
feature: stats
kind: logic-gap
severity: medium
confidence: verified
status: proposed
---

# Stats header counts ignore keymode and soft-deleted sets

## Problem

`streamManiaPass` keeps mania plays on the selected key count whose set is not soft-deleted. `getSessionStats` does not. It filters username, gamemode, and `s.delete_pending` only.

The header renders `summary.sessionCount`, average plays, and longest session from that query. `summary.pbCount` is on the API and asserted in tests, but `StatsPage` does not render it. Switching 4K to 7K changes the charts and leaves the header still.

Gamemode is a separate setting. It does not become mania because the page is on a key count. `all` and `auto` can include osu!, taiko, catch, and other keymodes.

## Potential solution

Pass `keyCount` into `getSessionStats` (it is already resolved in `getPlayerStats` before the call at line 607). Join `beatmaps` and `beatmap_sets` and copy the pass predicates:

```sql
JOIN beatmaps b ON b.id = s.beatmap_id
LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
-- existing: s.delete_pending = 0 and the username/gamemode fragment
AND COALESCE(bs.delete_pending, 0) = 0
AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
AND b.circle_size = ?
```

Use `b.ruleset_short_name` for the mania check, same as the pass. Keep the gamemode fragment on `s.ruleset_short_name`. A missing set still counts (`COALESCE(..., 0) = 0`), matching the pass.

Update the doc comment on `getSessionStats`. It currently claims the header matches the scoped charts. It does not.

## Do not

- Do not filter the header by gamemode alone and call it done. Key count is a query param, not a settings gamemode.
- Do not drop the username/gamemode fragment. F-016's original fix is still required. This adds the two predicates it missed.

## Touch

- `apps/server/src/analytics/playerStats.ts` — `getSessionStats` signature, SQL, call site
- `apps/server/src/analytics/playerStats.test.ts` — the F-016 block

## Tests

The F-016 tests compare the header to `referenceMetrics`, which is username + gamemode only. That reference locks the bug in. Extend it:

- One session of 4K mania and one of 7K mania. `getPlayerStats({ keyCount: 4 })` must not count the 7K session. Play-count charts and `sessionCount` move together.
- A non-pending score on a `beatmap_sets.delete_pending = 1` set is excluded from `sessionCount`, `pbCount`, average plays, and longest session.
- Existing username/gamemode cases stay green after the reference query gains the same joins.
