---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub
  - roxysu-hub-plan.md
  - knowledge/architecture/hub-vs-local.md
---

# Hub separate process

## Decision

Hub is a separate networked Elysia process and database; local practice remains offline-capable.

## Reason

Different trust model (OAuth, multi-user) and lifecycle from local-first analytics.

## Consequences

- Do not merge Hub auth into the local product API casually.
- Do not make local practice features require Hub availability.

## Relevant implementation

- `apps/hub/`
- `packages/db` hub schema
- `packages/hub-client`
