# `apps/hub` — Roxysu collection sharing API

## Overview

Two independent features in one app:

1. **Collection sharing** — osu! users log in, upload a beatmap collection, others browse and download it.
2. **Search cache** — admin-managed server-side cache for the Roxysu download page. Pre-warms expensive hinamizawa queries so users get instant results instead of hitting the mirror on every search.

These two concerns share the same Elysia process and SQLite file but have no overlap in schema or routes.

---

## Where it lives

```
apps/hub/          ← new workspace
apps/server/       ← existing, untouched
packages/db/       ← shared Drizzle schema, extended with new tables
```

Port: `4322` (server runs on `4321`).

Root `package.json` additions:
```json
"scripts": {
  "hub": "bun run --cwd apps/hub dev",
  "hub:build": "bun build apps/hub/src/index.ts --outdir apps/hub/dist --target bun"
}
```

---

## Database

### Adapter

`bun:sqlite` via `drizzle-orm/bun-sqlite`, dedicated `hub.sqlite`. Swappable to libsql/Turso or PostgreSQL later by changing one import and one connection string.

### Schema

#### Feature 1 — Collection sharing

```
users
  id            integer  PK autoincrement
  osu_id        integer  unique       -- from osu! /me
  username      text
  avatar_url    text
  role          text    default 'user'  -- 'user' | 'admin'
  created_at    integer

collections
  id            integer  PK autoincrement
  owner_id      integer  FK → users.id
  name          text
  description   text
  created_at    integer

collection_maps
  id              integer  PK autoincrement
  collection_id   integer  FK → collections.id
  beatmapset_id   integer
  map_name        text

collection_tags
  collection_id   integer  FK → collections.id
  tag             text
```

#### Feature 2 — Search cache

```
search_cache
  id              integer  PK autoincrement
  query_hash      text     unique       -- deterministic hash of normalized params
  query_params    text                  -- JSON: the original params as stored { mode: 3, status: "ranked" }
  beatmapset_ids  text                  -- JSON: number[] of all matching SetIDs
  total_count     integer
  cached_at       integer
  label           text                  -- optional human label e.g. "All ranked 7K"
```

`query_hash` is a SHA-256 (truncated to 16 chars is fine) of the params object with keys sorted and values lowercased. This makes `key=7&status=r` and `status=r&key=7` resolve to the same row.

---

## Tag enum (collection sharing)

```
mania | 4k | 7k | multi-mode | jump | stream | tech | ln | rice | hybrid | sv | beginner | dan
```

Validated server-side. Sent as a string array in the request body.

---

## Auth — osu! OAuth

Used **only for collection sharing** (login). The search cache is entirely internal — no user auth involved.

### Flow

```
1. GET /auth/login
   → redirect to https://osu.ppy.sh/oauth/authorize
       ?client_id=CLIENT_ID
       &redirect_uri=REDIRECT_URI
       &response_type=code
       &scope=identify

2. osu! redirects to GET /auth/callback?code=...

3. Hub POSTs to https://osu.ppy.sh/oauth/token
   → receives access_token

4. Hub GETs https://osu.ppy.sh/api/v2/me
   → receives { id, username, avatar_url }

5. Upsert user row, issue hub JWT, discard osu! token.
```

Two raw `fetch` calls. No library needed beyond `@elysiajs/jwt`.

### Environment variables

```
OSU_CLIENT_ID
OSU_CLIENT_SECRET
OSU_REDIRECT_URI          # e.g. http://localhost:4322/auth/callback
JWT_SECRET
HUB_CACHE_TTL_MS          # default 86400000 (24h)
```

---

## External dependency — Hinamizawa mirror

No API key, no auth. Two endpoints used:

### Search (cache population)

```
GET https://mirror.hinamizawa.ai/v3/osu/beatmaps/search/v2
  ?status=ranked
  &mode=3
  &limit=100
  &page=0
  # + any filters: min_stars, max_stars, key, etc.
```

Returns `{ results, total_count, total_pages }`. Paginate by incrementing `page` until all pages consumed. Each result has `SetID`.

The `query_params` stored in `search_cache` map 1:1 to these query string params.

### Download (client-side, not proxied)

```
GET https://mirror.hinamizawa.ai/api/v1/hinai/d/{beatmapset_id}
```

The hub never proxies downloads. The export/search endpoints return beatmapset IDs; the local Roxysu client constructs the download URL itself.

**Required:** all requests to hinamizawa must set:
```
User-Agent: roxysu-hub/0.1 (+https://github.com/Yon-Luc/Roxysu)
```

---

## API routes

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/login` | — | Redirect to osu! OAuth |
| GET | `/auth/callback` | — | Exchange code, issue JWT |
| GET | `/auth/me` | JWT | Current user info |

### Collection sharing (public read)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/collections` | — | Paginated list; `?tag=`, `?page=`, `?limit=` |
| GET | `/collections/:id` | — | Detail + beatmapset list |
| GET | `/collections/:id/export` | — | `{ beatmapsetIds: number[] }` |
| GET | `/collections/:id/missing` | — | `?have[]=123` → missing subset |

### Collection sharing (authenticated users)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/collections` | JWT | Create collection |
| PUT | `/collections/:id` | JWT (owner) | Update name / description / tags |
| DELETE | `/collections/:id` | JWT (owner or admin) | Delete |

`POST /collections` body:
```json
{
  "name": "My 7K tech pack",
  "description": "Short description",
  "beatmapsetIds": [292301, 39804],
  "tags": ["mania", "7k", "tech"]
}
```

### Search (cache-aware, used by Roxysu download page)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/search` | — | Cache-aware beatmap search |

```
GET /search?status=ranked&mode=3&key=7&page=0&limit=100
```

Logic:
1. Normalize + hash the query params.
2. Look up `search_cache` by `query_hash`.
3. **HIT + fresh** (`now - cached_at < TTL`): return slice of `beatmapset_ids` for requested page.
4. **HIT + stale**: return current cache, trigger background refresh (non-blocking).
5. **MISS**: forward live to hinamizawa, return results. Does **not** auto-cache — only admin creates cache entries.

Response shape (same whether cached or live):
```json
{
  "cached": true,
  "cached_at": 1720000000,
  "total_count": 4821,
  "beatmapset_ids": [292301, 39804, ...]
}
```

### Admin — search cache management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/cache` | JWT (admin) | List all cache entries + staleness |
| POST | `/admin/cache` | JWT (admin) | Create + prime a cache entry |
| POST | `/admin/cache/:id/refresh` | JWT (admin) | Re-run hinamizawa search, update row |
| DELETE | `/admin/cache/:id` | JWT (admin) | Drop a cache entry |

`POST /admin/cache` body:
```json
{
  "label": "All ranked 7K",
  "query_params": { "status": "ranked", "mode": 3 }
}
```

On creation, the hub immediately runs the hinamizawa search (paginating all pages), stores all `SetID`s in `beatmapset_ids`, and sets `cached_at`.

---

## Cache mechanic in detail

```
POST /admin/cache  { query_params: { status: "ranked", mode: 3 } }
  → normalize params (sort keys, lowercase values)
  → hash → "a3f9c1b2..."
  → paginate GET /v3/osu/beatmaps/search/v2?status=ranked&mode=3&limit=100&page=0,1,2,...
  → collect all SetIDs → [292301, 39804, ...]
  → INSERT INTO search_cache (query_hash, query_params, beatmapset_ids, total_count, cached_at, label)

Later: GET /search?status=ranked&mode=3
  → hash → "a3f9c1b2..."
  → SELECT * FROM search_cache WHERE query_hash = "a3f9c1b2..."
  → HIT → return beatmapset_ids slice
```

Pagination of the cached result on `/search` is handled in-process by slicing the stored `beatmapset_ids` JSON array — no DB query per page.

---

## Folder structure

```
apps/hub/
  src/
    index.ts                    -- Elysia entry, port 4322
    routes/
      auth.ts                   -- /auth/*
      collections.ts            -- /collections/*
      search.ts                 -- /search (cache-aware)
      admin.ts                  -- /admin/cache/*
    middleware/
      auth.ts                   -- JWT guard + admin guard
    services/
      osu-oauth.ts              -- token exchange + /me
      hinamizawa.ts             -- paginated search wrapper
      cache.ts                  -- hash, lookup, refresh, slice logic
    db.ts                       -- hub SQLite + drizzle
  package.json
  tsconfig.json
  .env.example
```

---

## Build order

### Phase 1 — Scaffold + osu! OAuth + collections CRUD
- `apps/hub` workspace, Elysia entry, `hub.sqlite`
- Drizzle schema: all 5 tables
- osu! OAuth: `/auth/login` → `/auth/callback` → JWT
- `POST /collections`, `GET /collections`, `GET /collections/:id`
- JWT guard + admin guard middleware

### Phase 2 — Collection export + missing diff
- `GET /collections/:id/export`
- `GET /collections/:id/missing?have[]=...`
- Tag filtering on collection list

### Phase 3 — Search cache
- `hinamizawa.ts` paginated search wrapper
- `cache.ts`: normalize, hash, lookup, slice
- `GET /search` with cache hit/miss/stale logic
- `POST /admin/cache`, `POST /admin/cache/:id/refresh`, `GET /admin/cache`, `DELETE /admin/cache/:id`

### Phase 4 — Polish
- Stale-while-revalidate background refresh
- Input validation with Elysia `t` schema on all routes
- Rate limiting
- Error response shapes
- `DELETE /collections/:id`
- Deploy config

---

## Deployment — Hetzner VPS + Coolify

### Setup in Coolify

1. Add a new **Resource → Application** pointing at the Roxysu repo
2. Set **Build context** to repo root (`/`)
3. Set **Dockerfile path** to `apps/hub/Dockerfile`
4. Add a **Persistent volume** mounted at `/app/data` — `hub.sqlite` lives here, survives redeploys
5. Set all environment variables in the Coolify UI (see below)
6. Coolify handles the reverse proxy, SSL, and restarts automatically

### Environment variables (set in Coolify UI)

```
OSU_CLIENT_ID=
OSU_CLIENT_SECRET=
OSU_REDIRECT_URI=https://hub.yourdomain.com/auth/callback
HUB_CLIENT_REDIRECT_URI=http://127.0.0.1:4321/#/hub-callback
JWT_SECRET=
ADMIN_OSU_ID=
HUB_CACHE_TTL_MS=86400000
DATABASE_URL=/app/data/hub.sqlite
PORT=4322
CORS_ORIGIN=*
```

**OAuth URI split:**
- `OSU_REDIRECT_URI` must match the hub callback registered on osu! (`…/auth/callback` on the hub domain).
- `HUB_CLIENT_REDIRECT_URI` is where the hub sends the browser after issuing a JWT (local Roxysu UI). Desktop and web both use `http://127.0.0.1:4321/#/hub-callback` by default.

On the Roxysu app side, set `HUB_URL` (default `http://localhost:4322`, or your public hub URL) so Download Maps / Hub UI can reach the API.

### `apps/hub/Dockerfile`

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Copy workspace root manifests first (better layer caching)
COPY package.json bun.lockb ./
COPY packages/ ./packages/
COPY apps/hub/ ./apps/hub/

# Install all workspace deps
RUN bun install --frozen-lockfile

# Build
WORKDIR /app/apps/hub
RUN bun build src/index.ts --outdir dist --target bun

# Runtime
EXPOSE 4322
CMD ["bun", "run", "dist/index.js"]
```

> **Note:** the Docker build context must be the **repo root**, not `apps/hub/`. This is so the build can reach `packages/db`. In Coolify: Build Context = `/`, Dockerfile location = `apps/hub/Dockerfile`.

### SQLite volume

`hub.sqlite` is created at `DATABASE_URL` on first run (Drizzle migrations run at startup). The Coolify volume mount at `/app/data` ensures the file persists across redeploys and container restarts.

If you ever want to back it up, a simple cron on the VPS:
```bash
cp /var/lib/docker/volumes/<volume_id>/_data/hub.sqlite ~/backups/hub-$(date +%Y%m%d).sqlite
```

---

## Favorites & download tracking

### Schema additions

```
collection_favorites
  user_id        integer  FK → users.id
  collection_id  integer  FK → collections.id
  created_at     integer
  PRIMARY KEY (user_id, collection_id)   -- one favorite per user per collection

collections
  + download_count  integer  default 0   -- incremented on every /export hit
```

Favorite count is always computed live: `SELECT COUNT(*) FROM collection_favorites WHERE collection_id = ?`. No denormalized column needed at this scale.

### Routes

```
POST   /collections/:id/favorite     JWT    -- add favorite
DELETE /collections/:id/favorite     JWT    -- remove favorite
GET    /auth/me/favorites            JWT    -- collections favorited by logged-in user
```

### Collection list response shape

Every item in `GET /collections` returns:

```json
{
  "id": 1,
  "name": "My 7K tech pack",
  "description": "Short description",
  "owner": {
    "osu_id": 12345,
    "username": "Yon-Luc",
    "avatar_url": "https://a.ppy.sh/12345"
  },
  "tags": ["mania", "7k", "tech"],
  "map_count": 42,
  "download_count": 317,
  "favorite_count": 28,
  "favorited_by_me": true
}
```

`favorited_by_me` is `false` when the request has no JWT (anonymous browse), `true/false` based on `collection_favorites` when a JWT is present.

`download_count` is incremented atomically:
```sql
UPDATE collections SET download_count = download_count + 1 WHERE id = ?
```

---

## Monorepo integration — Eden Treaty client (`packages/hub-client`)

Rather than manually maintaining request types or relying on OpenAPI, the hub exports its Elysia `App` type directly and any other workspace consumes it through a typed Eden Treaty client.

### How it works

Elysia infers a complete type from your route definitions. Eden Treaty turns that type into a fully typed fetch client — autocomplete on every route, request body, query params, and response shape. No codegen, no spec file, no drift between server and client.

### Package

```
packages/hub-client/
  src/index.ts       -- exports createHubClient()
  package.json       -- deps: @elysiajs/eden, @roxysu/hub (for the App type)
  tsconfig.json
```

### Usage anywhere in the monorepo

```ts
import { createHubClient } from "@roxysu/hub-client"

// Public (no auth)
const hub = createHubClient("http://localhost:4322")
const { data } = await hub.collections.get({ query: { tag: "7k" } })

// Authenticated
const hub = createHubClient("http://localhost:4322", jwtToken)
const { data } = await hub.collections.post({
  name: "My 7K pack",
  beatmapsetIds: [292301, 39804],
  tags: ["mania", "7k"],
})

// Detail + export
const { data } = await hub.collections({ id: 1 }).export.get()
```

The `App` type is exported from `apps/hub/src/index.ts` and referenced only as a TypeScript type import — zero runtime dependency on the hub process from the client package.

### Why not OpenAPI / Swagger

OpenAPI requires a codegen step, a spec file to keep in sync, and a separate dependency. Eden works off the TypeScript types that Elysia already produces — nothing extra to maintain. Removing `@elysiajs/swagger` keeps the dep list minimal.
