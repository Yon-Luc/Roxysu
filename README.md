# Roxysu

**Local-first practice analytics for [osu!lazer](https://osu.ppy.sh/home/download).**

Roxysu indexes your lazer play history (read-only), computes practice-focused analytics, and serves a local web UI — so you can search scores, track mastery, group sessions, and build smart collections without leaving your machine.

It does not modify osu!lazer data except for one optional, manual action: syncing smart collections into lazer as `!Roxysu`-prefixed beatmap collections (with a backup of `client.realm` first). Everything stays offline on your computer.

Open **http://localhost:4321/** after starting the app.

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
Collections are saved query strings, not static lists — they stay up to date as your library grows. Create, delete, and paginate match results. Use **Sync to osu!lazer** (Collections page) to push them into lazer as `!Roxysu {name}` collections — close lazer first; Roxysu backs up `client.realm` before writing.

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

Deeper design notes live in [`docs/architecture.md`](./docs/architecture.md).

---

## Getting started

### Prerequisites

- [Bun](https://bun.sh/)
- [Node.js](https://nodejs.org/) LTS (for realm-reader)
- osu!lazer installed with local play history
- On NixOS: `nix develop` (or direnv via `.envrc`) for Bun, Node, and native-module libraries. Desktop app: `nix build .#roxysu` uses the prebuilt release payload; refresh it with `nix flake update linux-resources`.
- On Windows: if `bun install` fails building `realm` / `better-sqlite3`, install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Desktop development with C++) and retry

### Install & run

```bash
bun install
bun run dev
```

That starts the server on port **4321** and the continuous Realm sync loop. Open http://localhost:4321/.

Useful one-offs:

```bash
# Server only
bun run --cwd apps/server dev

# Sync once (no watch loop)
bun run --filter '@roxysu/realm-reader' sync-once

# Database migrations
bun run --filter '@roxysu/db' db:generate
bun run --filter '@roxysu/db' db:migrate

# Unit tests
bun test
```

### Environment

Copy [`.env.example`](./.env.example) if you want overrides. All variables are optional.

| Variable | Default / purpose |
| --- | --- |
| `REALM_PATH` | `{osu data}/client.realm` |
| `DB_PATH` | `apps/server/data.sqlite` |
| `OSU_DATA_PATH` | Platform default (see below) — used for covers / `.osu` files |
| `REALM_FULL_SYNC=1` | Force a full reconcile on reader start |
| `REALM_RESYNC_MS` | Poll interval (default `60000`) |

**Default osu!lazer data folder** (when env/Settings unset):

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\osu` |
| macOS | `~/Library/Application Support/osu` |
| Linux | `~/.local/share/osu` |

You can also set the osu!lazer data folder in **Settings** (folder that contains `client.realm` and `files/`). Precedence: `OSU_DATA_PATH` / `REALM_PATH` env → Settings override → platform default.

If the UI looks empty after first start, wait for the realm-reader to finish an initial sync (or check Settings that the lazer path is correct).

---

## Design principles

1. **Never modify lazer data** — read-only Realm access
2. **Everything searchable** — one query language across practice, collections, and search
3. **Analytics over browsing** — mastery, sessions, retries, trends
4. **Local-only** — your scores stay on your machine
5. **Disjoint ownership** — realm-reader writes import tables; the server owns analytics and app tables

---

## Credits

Roxysu builds on work and services from the osu! community. Thank you to:

| Project | Used for |
| --- | --- |
| [osu!](https://osu.ppy.sh) / [osu!lazer](https://github.com/ppy/osu) | Game client, play history (`client.realm`), beatmaps, and official star ratings |
| [Hinamizawa (hinai)](https://mirror.hinamizawa.ai/) | Online beatmap search and `.osz` downloads |
| [Nerinyan](https://nerinyan.moe/) / [osu.direct](https://osu.direct/) | Alternate beatmap download mirrors |
| [Daniel](https://thebagelofman.github.io/Daniel/) ([TheBagelOfMan](https://github.com/TheBagelOfMan)) | 4K rice dan / star difficulty estimates |
| [Sunny Rework](https://github.com/sunnyxxy/Star-Rating-Rebirth) ([Crz]sunnyxxy and collaborators) | Mania Sunny star and dan label estimates |
| [tosu](https://github.com/tosuapp/tosu) | Live selected-map data via WebSocket |
| [Companella](https://github.com/Leinadix/companella) / [Interlude (YAVSRG)](https://github.com/YAVSRG/YAVSRG) | Mania pattern analysis (ported) |
| [Enissay mania SR rework](https://github.com/EnissayDev/osu/tree/enissay-mania-sr-rework) | Rating Lab experiment calculator branch |

osu! and the osu! logo are trademarks of ppy Pty Ltd. Roxysu is an unofficial community tool and is not affiliated with or endorsed by ppy.

---

## Status

Phases 1–5 are in place: Realm sync, API + SSE, dashboard, practice library, query language, collections, sessions, and mania Sunny dan ratings.

Still planned: notes/tags, backup/restore, further performance work, and optional live memory reading.
