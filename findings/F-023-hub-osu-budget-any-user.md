---
id: F-023
feature: hub
kind: security
severity: medium
confidence: verified
---

# Any signed-in Hub user can read the global osu! API budget

## What

`GET /osu/budget` sits on `requireAuth` and returns `budgetHistory(1)`: today’s and yesterday’s call counts and whether the shared rate limit has fired. The admin ledger is a different route, `GET /admin/osu-budget`, behind `requireAdmin`.

## Status

Fixed. `GET /osu/budget` is removed; no client called it. `apps/hub/src/routes/osuScores.routes.test.ts` covers the 404 and the admin 401. Knowledge security rule 3 in `knowledge/features/online-score-pull/index.md` records the remaining exposure.

## Why

Knowledge rule 2 for online score pull says the usage ledger admin route requires admin. The same `budgetHistory` helper backed both routes. The extra route exposed the process-wide osu! quota, which is shared across Hub users (about 50 calls per minute).

Correction: `scores/best` and `scores/progress` return the same process-wide live snapshot, not a per-user budget. The Settings panel shows it on purpose. Only the historical ledger (today, yesterday, limited counts) was the leak.

## How to improve

Remove `GET /osu/budget` from the user router, or return only the caller’s in-flight pull state. Keep `budgetHistory` on the admin route.

## Potential gain

Shared osu! quota timing is not visible to every Hub account.

## Evidence

- `knowledge/features/online-score-pull/index.md` security rule 2: admin ledger enforced by `osuBudgetAdminRoutes`.
- `apps/hub/src/routes/osuScores.ts` (lines 18–55): `requireAuth` group includes `.get("/budget", async () => budgetHistory(1))`. Admin group is separate at line 53.
- `apps/hub/src/services/osuScores.ts` `budgetHistory` aggregates `osuApiUsage`.
