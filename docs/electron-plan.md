# Electron Windows desktop plan

Ship a **Windows-only** Roxysu executable for non-developer users, while keeping the existing **Bun + browser** workflow for Linux / local development. The desktop app lives in the monorepo and shares as much code as possible with the web stack.

## Goals

- One double-click / installer experience on Windows (no Bun/Node install required).
- Same product surface as the local web UI for practice, sessions, collections, stats, settings, etc.
- Maximum code reuse: React UI, realm-reader, packages, and most Elysia API routes.
- Keep `bun run dev` as the primary path for contributors.

## Non-goals (v1)

- macOS / Linux Electron builds (can add later; same app, different electron-builder targets).
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

### NixOS dev shell

`flake.nix` provides `pkgs.electron_42` (fallback: `pkgs.electron`) and sets:

- `ELECTRON_SKIP_BINARY_DOWNLOAD=1`
- `ELECTRON_PATH` → nixpkgs **wrapped** `${electron}/bin/electron`

Important: use the wrapper, not `libexec/electron/electron` / `ELECTRON_OVERRIDE_DIST_PATH` — the raw dist binary can SIGILL on NixOS.

Smoke test: `nix develop` → `bun run desktop` (Hello window in `apps/desktop`).

Suggested `apps/desktop` growth:

- Electron `main` / `preload` (done for smoke)
- Node Elysia bootstrap (`index.node.ts` or import shared `createApp({ runtime: "node" })`)
- `electron-builder` config (`win` only)
- Scripts: `dev`, `pack`, `dist`

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

### M0 — Spike (1–2 days)

- Prove Elysia + `@elysiajs/node` + `client.node` can serve a minimal route and the existing UI over localhost.
- Document any broken Bun-only imports found at import time.

### M1 — Runtime adapters

- `createApp` / dual entry.
- Neutralize `serveHashedFile` and static serving.
- Desktop mounts product routes; excludes Lab + SW.

### M2 — `apps/desktop` shell

- Electron main loads localhost UI.
- Dev script: spawn/use local Node server entry (or Electron runs it in-process).
- Realm sync wired (child/utility) using existing realm-reader code.

### M3 — Packaging-aware sync & paths

- Collection sync without `bunx`/`tsx`.
- `%APPDATA%\Roxysu` defaults for DB/backups.
- Resource paths work under `electron-builder` output (not monorepo cwd).

### M4 — Windows artifact

- `electron-builder` win target.
- `@electron/rebuild` for native addons.
- Clean-machine install test; first-run lazer path via Settings if needed.

### M5 — Product polish

- Hide Lab in desktop UI.
- External links → OS browser.
- Tray / quit behavior / basic error surfacing.
- (Later) auto-update.

## Effort sketch

| Phase | Rough effort |
| --- | --- |
| Spike + adapters + desktop shell (dev) | several days |
| Packaging-aware sync + Windows dist | ~1–2 weeks total to a usable ship |
| Polish / auto-update | after first install works |

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
