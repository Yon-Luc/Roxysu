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

## Why

Knowledge rule 2 for online score pull says the usage ledger admin route requires admin. The same `budgetHistory` helper backs both routes. The authenticated bests route already returns that user’s pull budget. The extra route exposes the process-wide osu! quota, which is shared across Hub users (about 50 calls per minute).

## How to improve

Remove `GET /osu/budget` from the user router, or return only the caller’s in-flight pull state. Keep `budgetHistory` on the admin route.

## Potential gain

Shared osu! quota timing is not visible to every Hub account.

## Evidence

- `knowledge/features/online-score-pull/index.md` security rule 2: admin ledger enforced by `osuBudgetAdminRoutes`.
- `apps/hub/src/routes/osuScores.ts` (lines 18–55): `requireAuth` group includes `.get("/budget", async () => budgetHistory(1))`. Admin group is separate at line 53.
- `apps/hub/src/services/osuScores.ts` `budgetHistory` aggregates `osuApiUsage`.
