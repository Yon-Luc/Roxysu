---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/routes/auth.ts
  - apps/hub/src/middleware/auth.ts
  - apps/server/public/features/hub
  - packages/hub-client
---

# Hub

## Purpose

Optional online service for sharing collections and maintaining a search cache. Separate process and database from local practice data.

## Business meaning

Networked collaboration / discovery — not required for local practice analytics.

## Security rules

1. Authenticated Hub API routes require a valid osu! OAuth JWT.
   **Enforced by:** `apps/hub/src/middleware/auth.ts` — status: verified
   **Unauthorized result:** request rejected before mutation

2. Collection update is owner-only.
   **Enforced by:** hub route authorization checks — status: verified
   **Unauthorized result:** forbidden

3. Collection delete allowed for owner or admin.
   **Enforced by:** hub route authorization checks — status: verified
   **Unauthorized result:** forbidden

4. Search-cache admin operations require admin role.
   **Enforced by:** hub admin checks — status: verified
   **Unauthorized result:** forbidden

## Important symbols

- `apps/hub/src/*`
- `apps/server/src/routes/system.ts` — local OAuth handoff helpers
- `packages/hub-client`

## Dependencies

- `architecture/hub-vs-local.md`
- `features/smart-collections/` — local sync of hub collections

## Depended on by

- local Hub UI pages under `apps/server/public/features/hub`

## Related knowledge

- [business/hub-permissions.md](../../business/hub-permissions.md)
- [decisions/hub-separate-process.md](../../decisions/hub-separate-process.md)
