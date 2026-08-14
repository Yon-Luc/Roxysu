---
last_verified: 2026-08
confidence: verified
touches:
  - apps/hub/src/index.ts
  - apps/server/src/hubUrl.ts
  - roxysu-hub-plan.md
  - packages/db/src/hub
  - apps/hub/Dockerfile
  - apps/hub/docker-compose.yml
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
4. Client app Workshop, OAuth redeem, and Download Maps hub-search-index lookup share one Hub URL via `resolveHubBaseUrl()` (env `HUB_URL`, default `http://localhost:4322`). Hub down still falls back to live mirrors for downloads.
5. Production Hub CORS allowlists Workshop origins (typically `http://127.0.0.1:4321`); it does not use `*`.

## Related knowledge

- [vocabulary.md](../vocabulary.md) — Client app, Hub, Hub store, Hub search index
- [features/hub/index.md](../features/hub/index.md)
- [business/hub-permissions.md](../business/hub-permissions.md)
- [business/local-no-auth.md](../business/local-no-auth.md)
- [decisions/hub-separate-process.md](../decisions/hub-separate-process.md)
