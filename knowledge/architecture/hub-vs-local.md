---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/index.ts
  - roxysu-hub-plan.md
  - packages/db/src/hub
---

# Hub vs local

## Purpose

Separate the offline practice product from the optional online sharing service.

## Business meaning

- **Local app** (`apps/server` + `apps/realm-reader`): indexes lazer play history, analytics, smart collections. No user auth on the product API.
- **Hub** (`apps/hub`): networked collections + search cache; osu! OAuth JWT; separate DB (`hub.sqlite`).

## Business rules

1. Hub is not the local practice SoT.
2. Local core practice features must remain usable offline.
3. Hub-added collections synced to lazer use synthetic ids `HUB_SYNC_ID_BASE + hubId` (`packages/collection-sync`).

## Related knowledge

- [features/hub/index.md](../features/hub/index.md)
- [business/hub-permissions.md](../business/hub-permissions.md)
- [business/local-no-auth.md](../business/local-no-auth.md)
- [decisions/hub-separate-process.md](../decisions/hub-separate-process.md)
