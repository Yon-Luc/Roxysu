---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/index.ts
  - roxysu-hub-plan.md
  - packages/db/src/hub
---

# Hub vs client app

## Purpose

Separate the offline practice product from the optional online sharing service.

## Business meaning

- **Client app** (`apps/server` + `apps/realm-reader`): indexes lazer play history, analytics, collections. No user auth on the product API.
- **Hub** (`apps/hub`): networked collections + hub search index; osu! OAuth JWT; separate Hub store (`hub.sqlite`).

## Business rules

1. Hub is not the client app's practice source of truth.
2. Core practice features must remain usable offline.
3. Hub-added collections written back to Realm use synthetic ids `HUB_SYNC_ID_BASE + hubId` (`packages/collection-sync`).

## Related knowledge

- [vocabulary.md](../vocabulary.md) — Client app, Hub, Hub store, Hub search index
- [features/hub/index.md](../features/hub/index.md)
- [business/hub-permissions.md](../business/hub-permissions.md)
- [business/local-no-auth.md](../business/local-no-auth.md)
- [decisions/hub-separate-process.md](../decisions/hub-separate-process.md)
