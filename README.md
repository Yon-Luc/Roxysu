# Roxysu

**Local-first practice analytics for [osu!lazer](https://osu.ppy.sh/home/download).**

Roxysu indexes your lazer play history (read-only), computes practice-focused analytics, and serves a local web UI — so you can search scores, track mastery, group sessions, and build smart collections without leaving your machine.

It never modifies osu!lazer data. Everything stays offline on your computer.

Open **http://localhost:3000/** after starting the app.

---

## Features

### Dashboard
At-a-glance view of your library: indexed score/beatmap counts, sync status, the current play session, weekly activity, PP/accuracy trends, and recent scores.

### Practice library
Browse every map you’ve played as practice cards — play count, best accuracy, misses, PP, mastery, and last played. Filter with plain text or the query language; sort by last played, accuracy, misses, score, PP, mastery, or stars. Click distribution chart bars to refine filters.

### Practice profiles
Per-beatmap deep dive: cover art, stats, mastery, recent scores, sessions on that map, and (for mania) Sunny dan estimates. Copy a search string for use in-game.

### Sessions
Scores are auto-grouped into sessions by inactivity gaps. Browse past sessions, or open the live **current session** hub (SSE-updated as new plays land). Under **Suggest maps**, switch between **Up Next** (query-language accuracy/staleness filters) and **7K recommendations** (Sunny skill estimate with Push / Consistency / Deficit / Skillset). Run Sunny dan backfill in Settings first for best 7K results.

### Smart collections
Collections are saved query strings, not static lists — they stay up to date as your library grows. Create, delete, and paginate match results.

### Query language
One DSL powers practice search, collections, and global search:

| Field | Example |
| --- | --- |
| `mode`, `mapper`, `title`, `artist`, `diff` | `mode:mania`, `title:^SL_5` |
| `stars`, `key`, `ln` | `stars:5..6`, `key=7`, `ln<10` |
| `dan`, `sunny` / `danstars` | `dan:"Regular 4"`, `sunny:5..6` |
| `mods`, `acc`, `misses`, `score`, `pp` | `acc>98`, `mods:DT` |
| `retry`, `mastery`, `played` | `mastery>80`, `played:never` |

Boolean `AND` / `OR` / `NOT`, ranges (`stars:5..6`), comparisons (`acc>98`), and `^` prefix matches on text fields. Plain text without fields searches titles and artists.

Examples:

```text
mode:mania stars:5..6
key=7 ln<10
key=7 dan:"Regular 4"
acc:90..93 NOT played:last14d
(mode:osu OR mode:mania) stars:6..7
```

### Mastery & settings
Choose a mastery formula (`simple` or `practice`) and recompute across your library. Prefer **osu! stars**, **Sunny dan** labels, or **Sunny rework stars** for rating display. Kick off a background Sunny dan backfill for mania maps from Settings.

### Live sync
A separate process continuously mirrors `client.realm` into local SQLite. In Settings you can opt in to pause sync when the browser tab is unfocused (off by default), so lazer isn’t fighting for the Realm file during score submission. The UI shows Synced / Syncing / Paused / Failed and updates over SSE.

### Mania Sunny dan
Parses `.osu` files from lazer storage, runs a Sunny Rework–style estimate, caches dan labels and Sunny stars, and makes them queryable (`dan:`, `sunny:`, `key=`, `ln`). **7K smart recommendations** depend on these cached ratings — kick off a background Sunny dan backfill from Settings so skill estimates and ranked picks have enough data.

---

## Architecture

```text
osu!lazer
    │
client.realm (read-only)
    │
apps/realm-reader (Node)
    │
SQLite (shared bus, WAL)
    │
apps/server (Bun + Elysia)
    │
Analytics → HTTP API + SSE → React UI
```

| Package | Role |
| --- | --- |
| `apps/server` | Bun API, analytics pipeline, React UI |
| `apps/realm-reader` | Node + Realm JS sync from `client.realm` |
| `packages/db` | Shared Drizzle schema + Bun/Node SQLite clients |

Realm JS (and `better-sqlite3`) don’t run on Bun, so sync lives in its own Node process. Both apps share one schema via `@roxysu/db`; SQLite is the only integration point between them.

Deeper design notes live in [`osu-practice-companion-architecture.md`](./osu-practice-companion-architecture.md).

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh/)
- [Node.js](https://nodejs.org/) (for realm-reader)
- osu!lazer installed with local play history
- On NixOS: `nix develop` (or direnv via `.envrc`) for Bun, Node, and native-module libraries

### Install & run

```bash
bun install
bun run dev
```

That starts the server on port **3000** and the continuous Realm sync loop. Open http://localhost:3000/.

Useful one-offs:

```bash
# Server only
bun run --cwd apps/server dev

# Sync once (no watch loop)
bun run --filter '@roxysu/realm-reader' sync-once

# Database migrations
bun run --filter '@roxysu/db' db:generate
bun run --filter '@roxysu/db' db:migrate
```

### Environment

| Variable | Default / purpose |
| --- | --- |
| `REALM_PATH` | `$HOME/.local/share/osu/client.realm` |
| `DB_PATH` | `apps/server/data.sqlite` |
| `OSU_DATA_PATH` | Parent of the realm (or `$HOME/.local/share/osu`) — used for covers / `.osu` files |
| `REALM_FULL_SYNC=1` | Force a full reconcile on reader start |
| `REALM_RESYNC_MS` | Poll interval (default `60000`) |

Linux paths are inferred when unset. You can also set the osu!lazer data folder in **Settings** (folder that contains `client.realm` and `files/`). Precedence: `OSU_DATA_PATH` / `REALM_PATH` env → Settings override → `$HOME/.local/share/osu`.

---

## Design principles

1. **Never modify lazer data** — read-only Realm access
2. **Everything searchable** — one query language across practice, collections, and search
3. **Analytics over browsing** — mastery, sessions, retries, trends
4. **Local-only** — your scores stay on your machine
5. **Disjoint ownership** — realm-reader writes import tables; the server owns analytics and app tables

---

## Status

Phases 1–5 are in place: Realm sync, API + SSE, dashboard, practice library, query language, collections, sessions, and mania Sunny dan ratings.

Still planned: notes/tags, backup/restore, further performance work, and optional live memory reading.
