---
last_verified: 2026-08
confidence: verified
touches:
  - docs/architecture.md
---

# No IPC between processes

## Decision

realm-reader and server do not speak a private protocol; SQLite is the integration point.

## Reason

Avoid designing/versioning a second API between two owned processes.

## Consequences

- Do not add ad-hoc sockets/queues between reader and server without revisiting this decision.
- Signaling for live UI is server-side polling of SQLite + SSE.

## Relevant implementation

- `apps/server/src/sse.ts`
- `apps/realm-reader` write path only
