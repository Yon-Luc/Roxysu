# Electron Windows desktop plan

Ship a **Windows-only** Roxysu executable for non-developer users, while keeping the existing **Bun + browser** workflow for Linux / local development. The desktop app lives in the monorepo and shares as much code as possible with the web stack.

## Goals

- One double-click / installer experience on Windows (no Bun/Node install required).
- Same product surface as the local web UI for practice, sessions, collections, stats, settings, etc.
- Maximum code reuse: React UI, realm-reader, packages, and most Elysia API routes.
- Keep `bun run dev` as the primary path for contributors.

## Non-goals (v1)

- macOS Electron builds (can add later; same app, different electron-builder targets).
- Linux AppImage for non-Nix users (optional later). NixOS uses the Linux resources tarball + nixpkgs Electron instead.
- Porting the Bun server *into* Electron’s process as a Bun runtime.
- Bundling **tosu** / ManiaMapAnalyser.
- Shipping **Rating Lab** (dev/experiment tool; useless for end users).
- Service worker / PWA behavior in the desktop shell.
- Auto-update infrastructure (add after the first install path is solid).

## Target architecture

```text
apps/desktop (Electron, Windows)
  ├─ main / utility process
  │    ├─ Elysia app via @elysiajs/node  (shared routes, Node entry)
  │    ├─ SQLite via @roxysu/db/client.node
  │    └─ realm sync (in-process or child/utility — shared realm-reader code)
  └─ BrowserWindow → http://127.0.0.1:<port>
         └── same React UI as apps/server/public
```

Parallel product paths:

| Audience | How they run Roxysu |
| --- | --- |
| Devs / Linux | `bun run dev` → browser → Bun Elysia + Node realm-reader |
| Windows non-devs | `Roxysu.exe` → Electron → Node Elysia + realm sync + Chromium UI |

```text
shared
  React UI (apps/server/public)
  packages/* (db schema, osu-paths, sunny-dan, …)
  routes / analytics / query language / SSE

adapters
  bun:   client.bun + Bun listen/static   (apps/server today)
  node:  client.node + @elysiajs/node     (apps/desktop entry)
```

## Monorepo layout

```text
roxysu/
├── apps/
│   ├── server/          # Bun + Elysia — API, SSE, React UI (unchanged primary)
│   ├── realm-reader/    # Node — Realm sync (logic reused by desktop)
│   └── desktop/         # Electron shell (smoke app first; Node product entry later)
├── packages/
│   └── …                # already shared
└── docs/
    └── electron-plan.md
```

`apps/desktop` is covered by existing workspaces (`"apps/*"`). No separate repository.

### NixOS

| Command | Purpose |
| --- | --- |
| `nix develop` | Dev shell (Bun + nixpkgs Electron wrapper) |
| `nix build .#roxysu` / `nix run .#roxysu` | Packaged desktop app (prebuilt when hash pinned) |
| `nix build .#roxysu-from-source` | Full monorepo build (slow; needs `bunDepsHash`) |
| `nix profile install .#roxysu` | Install into your profile |
| `nix run github:Yon-Luc/Roxysu` | Same package, from GitHub (after push) |

**Fast path (preferred):** CI uploads `Roxysu-*-linux-x64-resources.tar.gz` on each
release. The flake input `linux-resources` points at that version's GitHub asset
(`releases/download/vX.Y.Z/Roxysu-X.Y.Z-linux-x64-resources.tar.gz`), pinned in
`flake.lock`. `publish.sh` rewrites the URL after CI uploads. Consumers of
`github:Yon-Luc/Roxysu` refresh with:

```bash
nix flake update --refresh
```

Then rebuild / `nix run`. Do not `nix flake update linux-resources` against a
mutable `releases/latest` URL — Nix's tarball cache can keep the previous payload.

**From-source fallback:** `nix/package.nix` still wraps nixpkgs Electron + Node.
After `bun.lock` changes, refresh `bunDepsHash` from the hash `nix build .#roxysu-from-source` prints.

Local tarball: `bun run desktop:dist:linux-resources` (Linux host / CI).

Suggested `apps/desktop` growth:

- Electron `main` / `preload` (done for smoke; main now boots Node + realm-reader)
- Node Elysia bootstrap (`index.node.ts` + shared `createApp`)
- `electron-builder` config (`win` only) — not yet
- Scripts: `dev` (build UI + Electron), `pack` (stage + rebuild natives), `dist:win` (Windows installer)

## What is already free (or nearly free)

### React client

Electron’s renderer is Chromium. Prefer loading `http://127.0.0.1:<port>` so Eden/`window.location.host` keeps working with **zero UI API changes**.

Optional later: load built `index.html` from disk and set an explicit API base URL.

Minor desktop polish (not blockers):

- Hide Rating Lab from nav / command palette / settings when `desktop`.
- Open external osu!/mirror links in the system browser.
- Disable or ignore `sw.js`.

### realm-reader

Logic is already Node + Realm JS + `@roxysu/db/client.node`. Reuse almost all of it.

Caveats:

- Rebuild native addons (`realm`, `better-sqlite3`) for **Electron’s Node ABI** (`@electron/rebuild`).
- Prefer a **utility process or child process** for sync so Realm/SQLite work does not block the UI main process.

### Elysia API

Most `/api/*` routes are runtime-agnostic once DB imports are neutralized. A desktop entry mounts the shared router and omits Lab / Bun-only plugins.

## Bun → Node work required

Elysia on Node is supported (`@elysiajs/node`). That alone is not enough; a few Bun-specific edges must be adapted.

### 1. Dual entry / app factory

Today `apps/server/src/app.ts` uses:

- `Bun.file` for `/sw.js`
- `staticPlugin({ bunFullstack: true, … })`

Desktop entry should:

- Use `new Elysia({ adapter: node() })`
- Serve static assets without `bunFullstack` (or let Electron load the UI URL from the Node server after a Bun-built `public/`)
- Skip service worker routes

Ideal shape: `createApp(options)` shared by Bun `index.ts` and Electron Node bootstrap.

### 2. DB client imports

Many server files import `@roxysu/db/client.bun`. `@roxysu/db/client.node` already exists.

Plan:

- Prefer runtime-neutral `import type { Db }` / schema imports where possible.
- Resolve the live client at the entrypoint (`ensureDb` from bun vs node).
- Avoid maintaining two copies of routes.

### 3. Small runtime helpers

Replace direct Bun calls with thin helpers used by both runtimes:

| Current | Desktop / Node equivalent |
| --- | --- |
| `Bun.file` in `serveHashedFile` (covers/audio) | `fs` / `createReadStream` / `Response` body |
| `Bun.sleep` | `setTimeout` promise |
| `Bun.spawn` in collection sync | in-process realm-reader call **or** packaged Node entry (no `bunx tsx`) |
| Rating Lab calculator `Bun.spawn` | **omit Lab** on desktop |

### 4. Feature surface / types

If desktop `App` omits `/api/rating-lab`, Eden `App` typing and UI must agree:

- Hide Lab in the UI for desktop builds, and/or
- Keep stub routes, or
- Use a shared “product routes” type plus optional “lab routes” only on Bun.

### 5. Collection sync without monorepo CLI

Today sync spawns `bunx tsx src/sync-collections-once.ts` with a monorepo `cwd`. Packaged desktop must not depend on that.

Preferred: call the same functions realm-reader already uses, from the Node desktop process (or a dedicated packaged script).

## Explicitly out of the desktop product (v1)

| Piece | Reason |
| --- | --- |
| Rating Lab UI + `/api/rating-lab` | Experiment / calc tooling |
| Service worker | Not useful in Electron |
| Bundled Bun runtime | Node-only product entry |
| Bundled tosu | Optional external dependency |

Sunny dan, practice, 7K recommendations, collections, mirrors, etc. **stay** — they are product features, not Lab.

## Packaging (Windows)

This is the main shipping cost.

1. **electron-builder** (or equivalent) with `win` target (NSIS installer and/or portable).
2. Bundle Node-side app code + prebuilt UI assets.
3. Native modules rebuilt for Electron (`realm`, `better-sqlite3`).
4. Data directory for non-devs, e.g. `%APPDATA%\Roxysu\` (`DB_PATH`, backups).
5. Default osu path remains `%APPDATA%\osu` (already implemented in `@roxysu/osu-paths`).
6. Single-instance lock; clean shutdown of HTTP server + sync on quit.
7. Test on a **clean Windows machine** without Bun/Node installed.

Frontend build: keep building `public/` with the existing Bun + Tailwind pipeline for both targets initially; desktop only needs the built assets + Node runtime.

## Process lifecycle

```text
Roxysu.exe start
  → single-instance check
  → start Node Elysia (localhost port)
  → start realm sync (utility/child)
  → open BrowserWindow → http://127.0.0.1:<port>
  → on quit: stop sync, stop server, exit
```

Optional polish (after MVP): tray icon, “Open data folder”, crash dialog, autostart with Windows.

## Implementation milestones

### M0 — Spike (done)

- Elysia + `@elysiajs/node` + `client.node` serve product API + Bun-built UI over localhost (`apps/server/src/index.node.ts`).

### M1 — Runtime adapters (done)

- `createApp` / dual entry ([`createApp.ts`](../apps/server/src/createApp.ts), Bun [`app.ts`](../apps/server/src/app.ts), Node [`index.node.ts`](../apps/server/src/index.node.ts)).
- Neutralized `serveHashedFile` and collection sync spawn/`sleep`.
- Shared `@roxysu/db/types`; routes import schema/types instead of `client.bun`.
- Desktop mounts product routes; excludes Lab + SW.

### M2 — `apps/desktop` shell (done for local smoke)

- Electron main loads localhost UI (spawns Node server + realm-reader child).
- Dev: `bun run desktop` (builds UI, then Electron).

### M3 — Packaging-aware sync & paths (done)

- Collection sync on Node/desktop calls `runCollectionSync` in-process (no `bunx`/`tsx`). Bun monorepo keeps the CLI spawn (Realm cannot load under Bun).
- Desktop data dir defaults: `%APPDATA%\Roxysu` / macOS Application Support / Linux XDG (`ROXYSU_DESKTOP=1`, `ROXYSU_DATA_DIR`, Electron `userData`). Backups stay beside the DB (`{dataDir}/backups`).
- Resource path helper [`apps/desktop/paths.js`](../apps/desktop/paths.js) resolves monorepo vs packaged `resources/` layout (`ROXYSU_STATIC_DIR`, `ROXYSU_SERVER_ENTRY`, `ROXYSU_REALM_ENTRY`, `ROXYSU_REALM_SCHEMA`).

### M4 — Windows artifact (done)

- `electron-builder` win target (NSIS + portable): [`apps/desktop/package.json`](../apps/desktop/package.json) — `bun run desktop:dist:win`.
- Staging pipeline [`apps/desktop/scripts/build-pack.mjs`](../apps/desktop/scripts/build-pack.mjs): bundle server + realm-reader (esbuild), copy UI + drizzle migrations + realm schema, `npm install` native deps per stage dir.
- [`apps/desktop/scripts/rebuild-native.mjs`](../apps/desktop/scripts/rebuild-native.mjs): `@electron/rebuild` for `better-sqlite3`, `@napi-rs/lzma`, `realm` against Electron’s Node ABI.
- Packaged layout → `resources/{public,server,realm-reader}` via `extraResources`; Electron main sets `ROXYSU_REALM_READER_DIR`, `ROXYSU_MIGRATIONS_FOLDER`, etc.
- Collection sync in packaged builds loads `realm-reader/syncCollections.js` (not monorepo `src/`).
- **CI:** [`.github/workflows/desktop-win.yml`](../.github/workflows/desktop-win.yml) builds on `windows-latest` when you push a `v*` / `desktop-v*` tag or run the workflow manually. Download the `.exe` files from the workflow’s **Artifacts** tab (unsigned; SmartScreen may warn on first run).

### M5 — Product polish

- Hide Lab / Download in desktop UI (nav, command palette, routes, settings).
- External links → OS browser.
- Tray / quit behavior / basic error surfacing.
- **Auto-update (NSIS / Windows):** `electron-updater` checks GitHub Releases (`Yon-Luc/Roxysu`) after the UI is ready, downloads in the background, then prompts “Restart to update”. Portable builds and unpackaged/dev runs skip the check. CI uploads `latest.yml` alongside the installer and syncs `apps/desktop` version from the release tag. Builds remain unsigned (SmartScreen may warn).

## Effort sketch

| Phase | Rough effort |
| --- | --- |
| Spike + adapters + desktop shell (dev) | several days |
| Packaging-aware sync + Windows dist | ~1–2 weeks total to a usable ship |
| Polish / auto-update | NSIS auto-update via GitHub Releases (portable excluded) |

Not a rewrite: React, realm-reader, and most APIs stay. Cost is adapters + Electron ABI packaging + process glue.

## What not to do

- Fork the React app into a separate Vite “Electron UI” unless forced to.
- Maintain a second copy of analytics / query language for desktop.
- Run heavy Realm sync on the Electron UI main thread.
- Block the first Windows ship on Lab, tosu bundling, or multi-OS builds.
- Wrap Bun binaries forever *and* also build a full Node Electron path without sharing an app factory — pick Node-in-Electron as the product runtime; keep Bun for the web/dev path.

## Success criteria

- Windows user installs Roxysu, opens the app, sees their lazer library after sync (default or Settings path).
- Core flows work: dashboard, practice, sessions, collections (including lazer sync), settings, stats.
- Rating Lab absent or unreachable in the desktop build.
- Contributors still use `bun run dev` unchanged.
- Desktop code lives under `apps/desktop` in this monorepo.
