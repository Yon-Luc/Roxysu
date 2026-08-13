---
last_verified: 2026-08
confidence: verified
touches:
  - docs/architecture.md
  - apps/server/src/analytics
  - apps/server/src/query-language
---

# Keep analytics in server

## Decision

Product modules (`analytics`, `query-language`, `search`) stay as folders under `apps/server/src/` until a second consumer needs extraction.

## Reason

Avoid premature packages; promote when reuse or hard boundaries appear.

## Consequences

- Prefer `@server/*` aliases over new packages for UI/server-shared types inside the server app.
- Extract to `packages/*` only when a second runtime/consumer appears.

## Relevant implementation

- `apps/server/src/analytics/`
- `apps/server/src/query-language/`
