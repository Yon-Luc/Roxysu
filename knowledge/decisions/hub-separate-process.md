---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/index.ts
  - roxysu-hub-plan.md
  - knowledge/architecture/hub-vs-local.md
---

# Hub separate process

## Decision

Hub is a separate networked Elysia process and Hub store; client app practice remains offline-capable.

## Reason

Different trust model (OAuth, multi-user) and lifecycle from offline-first analytics.

## Consequences

- Do not merge Hub auth into the client app API casually.
- Do not make core practice features require Hub availability.

## Relevant implementation

- `apps/hub/`
- `packages/db` hub schema
- `packages/hub-client` — Node Eden Treaty client (not the Community browser client)
