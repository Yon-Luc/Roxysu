# osu! Practice Companion

## Vision

A local-first analytics platform for **osu!lazer** that continuously indexes the local `client.realm` database, computes rich practice analytics, and exposes them through a local web interface.

## Goals

- Read-only access to osu!lazer Realm
- Live synchronization
- Local-only (offline)
- Cross-platform (Linux first, Windows/macOS supported)
- Fast search over 100k+ scores
- Extensible analytics
- Open source once mature

## Tech Stack

### apps/server (Bun)

- Bun runtime
- Elysia
- React (served statically, built with Bun's native bundler — `bunfig.toml` + `bun-plugin-tailwind`)
- TailwindCSS
- Drizzle ORM (`bun:sqlite` driver)
- Zod

### apps/realm-reader (Node)

- Node.js runtime (via `tsx`)
- Realm JS (official SDK — does not run on Bun, hence the separate process)
- Drizzle ORM (`better-sqlite3` driver)

### packages/db (shared)

- Drizzle schema — single source of truth for table shapes, imported by both apps
- Two runtime-specific client entry points on top of the same schema:
  - `client.bun.ts` → `drizzle-orm/bun-sqlite` + `bun:sqlite`
  - `client.node.ts` → `drizzle-orm/better-sqlite3` + `better-sqlite3`
- Exposed via `package.json` `exports` map (`@roxysu/db/schema`, `@roxysu/db/client.bun`, `@roxysu/db/client.node`)

> Why two runtimes: Realm JS doesn't run on Bun, and `better-sqlite3` doesn't run on Bun either (`bun:sqlite` is Bun's native alternative). Rather than forcing one runtime to do a job it doesn't support, each process uses whichever SQLite driver its runtime actually supports — while still sharing one schema, so the two processes can never drift on table shape.

### Planned frontend additions (not yet wired)

- TanStack Table (optional denser score tables)

Wired: TanStack Query, TanStack Router, Recharts.
## Architecture

```text
osu!lazer
    │
client.realm (read-only)
    │
apps/realm-reader (Node process)
    │  writes via @roxysu/db/client.node
    ▼
SQLite file (single, shared)
    ▲  reads/writes via @roxysu/db/client.bun
    │
apps/server (Bun process — Elysia)
    │
Analytics Engines
    │
HTTP API + SSE
    │
React Web UI
```

**No API layer between `realm-reader` and `server`.** The two processes never talk to each other directly — SQLite itself is the integration point, matching the `Realm → Mapper → SQLite` flow already implied by the original design. This avoids designing and versioning a private protocol between two of your own processes.

## Concurrency Strategy (two processes, one SQLite file)

SQLite supports multiple processes against the same file, but a few rules keep it safe:

- **WAL mode** (`PRAGMA journal_mode = WAL`) on both connections — allows the writer (`realm-reader`) and readers/writers (`server`) to operate without blocking each other on every transaction.
- **`busy_timeout`** set on both connections (a few hundred ms) — an occasional write/write collision retries silently instead of throwing `SQLITE_BUSY`.
- **Table ownership, not just goodwill:**
  - `realm-reader` only writes to **raw import tables**: `beatmaps`, `scores`, `imports`.
  - `server` only writes to **derived tables**: `sessions`, `mastery`, `daily_stats`, `weekly_stats`, `mapper_stats`, `score_metrics`, and everything user-authored (`notes`, `tags`, `collections`, `settings`).
  - `server` (via Drizzle) owns schema/migrations for the whole database; `realm-reader` only performs raw inserts against tables it doesn't define the shape of.
- **Short write transactions** — batch bulk imports (e.g. initial 100k-score import) into reasonably sized chunks rather than one giant transaction, to avoid holding the writer lock long enough to starve the server's own writes.

## Live-Update Signaling

`realm-reader` only writes to SQLite — it has no way to push events to the browser directly. `server` detects new data by **polling** SQLite every 1–2s for rows newer than the last-seen id/timestamp in `imports`, then emits the appropriate Event Bus event. This is simpler than building a second IPC channel between the two processes, and at this data volume/latency requirement it's more than sufficient — nothing here needs sub-second push semantics.

## Realm Sync Strategy

`realm-reader` prefers **watermark incremental sync** (`Score.Date` / `Beatmap.LastLocalUpdate` vs SQLite maxima), writing `imports.kind = "incremental"`. Every N cycles (default 10) — or on first run / `REALM_FULL_SYNC=1` — it runs a **full reconcile**: upsert all objects and delete SQLite orphans not present in Realm. Soft-deleted Realm objects are upserted with `delete_pending = true` (not skipped). Realm `addListener` change notifications are intentionally not used while lazer may exclusive-lock the file; polling + watermarks match the latency model above.
## Monorepo

```text
roxysu/
├── apps/
│   ├── server/          # Bun + Elysia — API, SSE, static frontend
│   └── realm-reader/     # Node — Realm listener, writes to SQLite
├── packages/
│   └── db/                # Drizzle schema + runtime-specific clients
├── docs/
└── scripts/
```

Only `db` is a real shared package for now — it's the one thing genuinely imported by two independently-run processes. The other conceptual modules from the original design (`analytics`, `query-language`, `search`, `shared`, `types`) start as **folders inside `apps/server/src/`**, not separate workspace packages:

```text
apps/server/src/
├── analytics/
├── query-language/
├── search/
└── shared/
```

TypeScript path aliases give the same import ergonomics as a workspace package without the overhead. Promote any of these to a real `packages/*` entry later if it needs to be reused outside `apps/server` (e.g. a future CLI) or needs a hard import boundary enforced.

## Dev Environment (NixOS)

Both native-dependency packages (`better-sqlite3`, `realm`) ship prebuilt binaries assuming a standard FHS layout, which NixOS doesn't have. A project-local `flake.nix` devShell handles this without touching system config:

- `NIX_LD` / `NIX_LD_LIBRARY_PATH` — points a compatibility loader at the dynamic linker and shared libs (`zlib`, `openssl`, `icu`, `stdenv.cc.cc`) these native binaries expect at runtime.
- `python3`, `gcc`, `gnumake` — fallback build toolchain for whenever a package's prebuilt binary doesn't match the installed Node/Bun ABI and `node-gyp` has to compile from source.
- `bun install` runs `trustedDependencies` install scripts for `better-sqlite3` and `realm` (blocked by default in Bun for security) — required for either native module to actually build/link.

`nix develop` (optionally via `direnv`) gets a contributor a working environment with zero manual global installs.

## Data Flow

```text
Realm
 ↓ (realm-reader, Node)
Mapper
 ↓
SQLite — raw tables
 ↓ (server polls for new rows)
Analytics Engines
 ↓
Events
 ↓
API
 ↓
Browser (SSE)
```

## Event Bus

Events:
- score.imported
- score.updated
- session.started
- session.finished
- mastery.updated
- collection.updated
- dashboard.updated
- sync.finished

Consumers:
- Session Engine
- Mastery Engine
- Statistics Engine
- Collections Engine
- SSE broadcaster

## Database Philosophy

Realm = immutable source of truth.

SQLite stores:
- Imported data (owned by `realm-reader`)
- Sessions, Notes, Tags, Collections, Saved searches, Mastery, Retry chains, Derived statistics, Settings (owned by `server`)

## Core Tables

- beatmaps / beatmap_sets / rulesets (raw)
- scores
- sessions
- collections (canonical `query` text — no separate filter JSON table)
- tags
- beatmap_tags
- notes
- mastery (`formula_id` records which mastery formula produced `level`)
- imports
- settings
- daily_stats
- weekly_stats
- mapper_stats
- score_metrics

## Mastery Formulas

Mastery is pluggable via an in-process registry (`apps/server/src/analytics/mastery/`):

- Active formula id stored in `settings` key `mastery.formula` (default `simple`).
- Shipping formulas: `simple` (acc + play count + PP), `practice` (acc + retries + consistency).
- Switching formula via `/api/settings` recomputes all mastery rows.

## Analytics Engines

- Session Engine
- Mastery Engine (pluggable formulas)
- Progression Engine (dashboard trend read-models)
- Retry Engine
- Statistics Engine
- Collection Engine / Search Engine (query language)
## Workspaces

### Dashboard
- Current session
- Recent scores
- Weekly activity
- PP trend
- Accuracy trend
- Continue practicing

### Practice
Beatmap practice cards with mastery and trends.

### Practice Profile
- Summary
- Mastery
- Charts
- Sessions
- Timeline
- Scores
- Notes
- Tags
- Collections

### Sessions
Automatic grouping of plays (30 min inactivity starts new session).

### Collections
Dynamic saved queries.

Examples:
- `stars:6..7`
- `mapper:Lasse`
- `title:^SL_5`

## Query Language

Examples:

```text
mode:mania
mapper:Lasse
stars:5..6
mods:DT
acc>98
retry>10
mastery>80
played:last30d
```

Supports boolean logic. Collections store query strings instead of JSON.

## API Domains

- /dashboard
- /practice
- /beatmaps
- /sessions
- /collections
- /search
- /settings
- /system

Prefer domain-oriented endpoints returning complete view models.

## Live Updates

Server-Sent Events, triggered by `server`'s poll loop over the raw import tables plus analytics-engine output:
- score.imported
- session.updated
- dashboard.updated
- sync.finished

## Optional Future Source: Live Memory Reading

Realm only reflects **completed** scores. A memory-reading approach (in the style of the `tosu` project) can optionally supply **live, in-progress** play state — current combo, accuracy, and beatmap while a play is happening — which Realm cannot provide until the score is written.

This would be added as a **third isolated adapter**, not a replacement for Realm:
- Depend on an already-running local `tosu`-style service via its WebSocket API, rather than writing a custom memory reader (avoids the ongoing maintenance burden of tracking game-memory offsets across osu! updates).
- Strictly optional — if it isn't running, only live-dashboard flourishes (e.g. "currently playing X, live acc Y%") are unavailable; all core analytics keep working off Realm-derived SQLite data alone.
- Used only for ephemeral UI state and as a trigger for session-start detection — never reconciled into permanent score records. Once a score is actually written to Realm, `realm-reader` remains the sole path into persisted data.

## Roadmap

### Phase 1 — Foundation *(done)*
- Workspace scaffold: `apps/server` (Bun/Elysia), `apps/realm-reader` (Node), `packages/db` (shared Drizzle schema, dual clients)
- NixOS devShell for native module builds
- SQLite schema + Drizzle migrations
- Realm JS integration — read `client.realm`, map to raw tables

### Phase 2 *(done)*
- Watermark incremental sync + periodic full reconcile (deletions)
- HTTP API
- SSE (via server poll loop)

### Phase 3 *(done)*
- Dashboard
- Practice list
- Practice profile

### Phase 4 *(done)*
- Query language (boolean AND/OR/NOT)
- Smart collections (query strings)
- Search

### Phase 5 *(done)*
- Analytics pipeline (Retry → Session → Mastery → Statistics)
- Pluggable mastery formulas
- Sessions, progression trends, retry metrics

### Phase 6
- Notes
- Tags
- Backup/restore
- Performance
- (Optional) Live memory-reading integration for real-time dashboard state

## Guiding Principles

1. Never modify osu!lazer data.
2. Everything is searchable.
3. Analytics over score browsing.
4. Feature-first frontend architecture.
5. Event-driven backend.
6. Keep Realm isolated behind an importer — now literally a separate OS process (`realm-reader`), not just a module boundary.
7. One schema, runtime-appropriate drivers — `packages/db`'s schema is the single source of truth; each process uses the SQLite driver its runtime actually supports.
8. Disjoint table ownership between processes — never both write the same table, to avoid write contention and keep failure modes easy to reason about.
