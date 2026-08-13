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

Optional online process for sharing collections and maintaining the hub search index. Separate Hub store from the client app's local mirror.

## Business meaning

Networked collaboration / discovery — not required for offline practice analytics.

## Security rules

1. Authenticated Hub API routes require a valid osu! OAuth JWT.
   **Enforced by:** `apps/hub/src/middleware/auth.ts` — status: verified
   **Unauthorized result:** request rejected before mutation

2. Edit collection: owner only.
   **Enforced by:** hub route authorization checks — status: verified
   **Unauthorized result:** forbidden

3. Delete collection: owner or admin.
   **Enforced by:** hub route authorization checks — status: verified
   **Unauthorized result:** forbidden

4. Hub search index admin operations require admin role.
   **Enforced by:** hub admin checks — status: verified
   **Unauthorized result:** forbidden

## Important symbols

- `apps/hub/src/*`
- `apps/server/src/routes/system.ts` — client app OAuth handoff helpers
- `packages/hub-client`

## Dependencies

- [architecture/hub-vs-local.md](../../architecture/hub-vs-local.md)
- `features/smart-collections/` — hub collections can write back to Realm

## Depended on by

- Hub UI pages under `apps/server/public/features/hub`

## Related knowledge

- [vocabulary.md](../../vocabulary.md) — Hub, Hub store, Hub search index
- [business/hub-permissions.md](../../business/hub-permissions.md)
- [decisions/hub-separate-process.md](../../decisions/hub-separate-process.md)
