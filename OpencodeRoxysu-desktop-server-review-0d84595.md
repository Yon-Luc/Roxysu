# Roxysu desktop + server — review of `0d84595` (`play/rune-migration`)

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Branch:** `play/rune-migration`  
**Commit reviewed:** `0d845951ffb59bb1b1e8486927f5f965311510a2`  
(“Add comprehensive overlay review and enhance desktop integration”, 2026-11-23 00:10 Europe/Lisbon)  
**Previous review tip:** `a07a7f50ac880df36ef842b9d83bb64922ab3f90`  
**Worktree:** `/workspace/rx-desktop-server-0d84595` (detached HEAD; other worktrees were not touched)  
**Previous reviews:** `/workspace/Roxysu-rune-desktop-review.md`, `/workspace/Roxysu-rune-server-review.md`  
**This file:** `/workspace/Roxysu-desktop-server-review-0d84595.md`  
**Review date:** 2026-11-23 (Europe/Lisbon)

Read-only review. Nothing was pushed or modified in the worktree (tests were executed in-place with `bun test`). Suggested patches match the existing CommonJS / TypeScript style and are proposals only.

---

## Counts

| Area | Still fixed | Still open | Partly fixed this commit | New this commit |
|------|-------------|------------|--------------------------|-----------------|
| Desktop (incl. D-NEW-1) | 7 | 9 | 0 | 0 |
| Server (incl. S-NEW-1) | 6 | 12 | 0 | 1 (S-NEW-2, Low) |
| **Total** | **13** | **21** | **0** | **1** |

No previously open item was fixed in this commit. The commit adds a monitor override (`overlay.output` / `--output`) for the in-game overlay host, with server-side validation and policy tests. Supervision, session listing, and shell-side URL/output checks are unchanged.

**Top 3 remaining issues**

1. **S-NEW-1** (Medium, regression) — `GET /api/sessions` with no `day` still returns every session.
2. **D-NEW-1** (Medium) — a visually dead overlay process is never restarted (`--watchdog-max-age-sec=0`).
3. **M7** (Medium) — overlay `apply()` is still not serialized and `stopChild` is still not awaited; changing the new monitor setting can stack two HUDs.

---

## What was and was not verified

**Verified in source** at `0d84595`. Every item from the `a07a7f5` desktop and server reviews was re-checked against current file:line evidence. New overlay-output code was reviewed for settings validation, argv injection, apply-policy races, and `stopChild` ordering.

**Tests executed**

- `bun test` in `apps/desktop`: **44 pass, 0 fail** across `overlayApplyPolicy.test.js`, `paths.extract.test.js`, `respawnPolicy.test.js`, `stopChild.test.js`, `urlPolicy.test.js`, `waitForServer.test.js`.
- `bun test` in `apps/server` for `src/overlayUrl.test.ts`, `src/executablePath.test.ts`, `src/hubUrl.test.ts`: **all of those tests passed** (11 tests).
- `src/originGuard.test.ts` did **not** run: this worktree has no installed `elysia` package (`Cannot find package 'elysia'`). The full `apps/server` suite was not executed. Dependencies were not installed.

**Not verified:** a live Electron 45 window, a Wayland / Plasma / niri overlay session, NSIS or the Windows launcher, first-run realm extract duration, a large session library against `GET /api/sessions`, SSE under many clients, or score-transfer of a large library. D-NEW-1 was not reproduced (no compositor on this box).

---

## What this commit changed (desktop / server)

Relevant diff vs `a07a7f5`:

| Change | Files |
|--------|--------|
| Shell tracks `overlayAppliedOutput`, passes `--output=…` when set, restarts the host when the monitor changes | `apps/desktop/main.js` |
| `decideOverlayApply` treats monitor changes like URL changes (restart; bypass the liveness gap) | `apps/desktop/overlayApplyPolicy.js`, tests |
| `parseOverlayOutput` + PATCH/GET for `overlay.host_output` | `apps/server/src/overlayUrl.ts`, `apps/server/src/routes/settings.ts`, `packages/db/src/settings-keys.ts` |
| Client `patchSettings` accepts `overlayOutput` | `apps/server/public/lib/api.ts` |

The official settings UI (`OverlayHostSection.tsx`) sends enable, URL, and monitor as **separate** PATCHes, not one combined body. Sessions listing, origin guard, listen bind, and the rest of `apps/server/src` were not changed in this commit. Overlay-rs CLI parsing uses clap (`=` inside a value is fine); the desktop comment that the “host pre-splits argv on `=`” is leftover wording, not how `cli.rs` works today.

`GET /api/settings` is still a modest JSON document (no skin sprites). The shell’s uncapped settings fetch is therefore less likely to blow the heap than an overlay-skins payload, but it still has no status check or byte cap.

---

## Desktop — status of earlier findings

| ID | Previous severity | Status at `0d84595` | Evidence |
|----|-------------------|---------------------|----------|
| H1 | High | **Still fixed** | `attachWindowGuards` in `main.js` 227–239, wired at 342: `setWindowOpenHandler` denies new windows and opens http(s)/`osu:` externally; `will-navigate` / `will-redirect` pin the window to `APP_ORIGIN`. Covered by `urlPolicy.test.js` (passed). |
| M2 | Medium | **Still fixed** | `ipcSenderIsApp` (`main.js` 245–253) requires `event.senderFrame.url` (fallback `webContents.getURL`) to be the app origin before `open-external` (753) or `write-clipboard-image` (773). Scheme check remains http(s) only. |
| M3 | Medium | **Still fixed** | `stopChild.js`: idempotent `done()`, falsey `kill()` resolves, re-check after SIGTERM, 5 s grace then 2 s SIGKILL deadline (10–12, 21–22). `before-quit` uses `.finally()` (`main.js` 982–990). Tests passed. **Callers that fire-and-forget `stopChild` are still M7.** |
| M4 | Medium | **Still fixed** (residual) | `waitForServer.js`: `settled` + `attemptDone`; `AbortSignal`; requires HTTP 200 and JSON `{ ok: true }`. Wired with `startupAbort` (`main.js` 901–904, 726–728). Residual: `GET /api/system/healthz` is still `{ ok: true }` (`routes/system.ts` 77) with no `service` marker. |
| M5 | Medium | **Still fixed** (residual) | try/catch around `loadAppIntoWindow` (920–926), `.catch` on `whenReady` (964–971), abort-aware wait. Residual: macOS `activate` (951–958) logs a failure but does not re-run `waitForServer` or update the splash. |
| M6 | Medium | **Still fixed** | `ensureRealmExtracted` is async. `startRealmReader` awaits it, bails if `shuttingDown` (394, 402), and `realmStartPromise` (369–382) prevents a double start. `paths.extract.test.js` passed. |
| M7 | Medium | **Still open** | See write-up. `apply()` still has no in-flight lock; `stopChild` is still not awaited (644, 662); `fetchOverlaySettings` is still an uncapped concat with no status check (562–594). The new monitor restart uses this same path. |
| M8 | Medium | **Still open** | Server child `'exit'` / spawn `'error'` still call `shutdown()` then `app.exit` (`main.js` 887–895). No respawn, no “server stopped” splash. |
| L1 | Low | **Still fixed** | `MAX_CLIPBOARD_IMAGE_BYTES = 15 * 1024 * 1024` (`main.js` 51) and the sender check (773, 782). |
| L2 | Low | **Still open** | `apps/server/public/index.html` still has no CSP; no CSP header in the server. Only `apps/desktop/splash.html` 6 has a CSP, and it is still replaced after `loadURL`. |
| L3 | Low | **Still open** | `webPreferences` is still only preload + `contextIsolation: true` + `nodeIntegration: false` (`main.js` 335–340). No `sandbox: true`. |
| L4 | Low | **Still open** | `desktopLog` still `appendFileSync`s to a single file (`main.js` 81–88). Child log fds are still opened once and reused (`openChildLogFd`, 115). |
| L5 | Low | **Still open** | `Menu.setApplicationMenu(null)` is still unconditional (`main.js` 833). macOS is still not a stated shipping target. |
| L6 | Low | **Still open** | `roxysu_launcher.c` 56, 59 still discards `cmdLine` and starts `RoxysuApp.exe` with only the quoted path. |
| L7 | Low | **Still open** (expanded) | Server PATCH still validates overlay URLs (`overlayUrl.ts` 10–28) and now validates monitor names (`parseOverlayOutput`, 35–43). The **shell** still takes `overlay.hostUrl` and `overlay.output` from `GET /api/settings` and interpolates `--url=${hostUrl}` / `--output=${output}` with no re-check (`main.js` 575–581, 517–518; `overlayApplyPolicy.js` 88–92). |
| D-NEW-1 | Medium | **Still open** | Spawn argv still includes `--watchdog-max-age-sec=0` (`main.js` 517). Liveness respawn still requires process exit (`childIsAlive`). No ping, tray restart, or replacement age cap was added. |

---

## Server — status of earlier findings

| ID | Previous severity | Status at `0d84595` | Evidence |
|----|-------------------|---------------------|----------|
| H1 | High | **Still fixed** | `resolveListen()` defaults to `127.0.0.1` (`listen.ts` 2, 19). Both `index.ts` 38 and `index.node.ts` 38 use it. `listenExposureWarning` (`listen.ts` 37) still documents that `localhost` is not loopback-only. Runtime bind was not re-probed. |
| H2 | High | **Still open** (reduced) | `assertSafeExecutablePath` is unchanged and its unit tests passed. Settings can still point at any absolute regular file and the server will `spawn()` it. |
| M1 | Medium | **Still fixed** | `originGuard()` is still used from `app.ts` 14 and `createApp.ts` 91. The originGuard unit tests could not be executed here (missing `elysia`). Source was re-read; the guard itself was not changed in this commit. |
| M2 | Medium | **Still open** | `routes/beatmaps.ts` still `readFileSync` + parse on `GET /:id/preview` (409) and returns every hit object on the request thread. |
| M3 | Medium | **Still open** | `routes/skins.ts` still `readFileSync`s each asset and `zipSync`s the archive in memory (24, 150, 174). |
| M4 | Medium | **Still open** (reduced) | Unique upload dirs / size cap / timeout / shutdown discard are unchanged. **`loadIndex` still `select`s every score and every beatmap** (`transfer.ts` 128–154) on preview and apply. |
| M5 | Medium | **Still fixed** | `parseOverlayHostUrl` is unchanged (no credentials; http(s) only). `parseOverlayOutput` is a new sibling and is used on PATCH. Tests for both passed. |
| M6 | Medium | **Still open** | `startCollectionMatchCache` is still called from `index.ts` 49 and `index.node.ts` 69 with no matching stop/drain in `shutdown`. Score-transfer uploads *are* discarded (`index.ts` 109, `index.node.ts` 125). Still no `process.on("unhandledRejection")` on either entry. |
| M7 | Medium | **Still open** | `GET /settings/calc-bundle/status` still does `(await exportCalcBundleEntries(db)).length` (`routes/settings.ts` 239–243). |
| M8 | Medium | **Still open** (reduced) | Overlay skins PUT still `{ body: t.Any() }` (`overlay.ts` 211, 271). Per-sprite 8,000,000 character cap remains (~250); sprite *count* is still unbounded. Single `POST /collections/` name/query still has only `minLength: 1` (`collections.ts` 432–433); PATCH name/query at 607–608 still lack `maxLength`. Batch routes already have caps (497–498). |
| M9 | Medium | **Still fixed** | `hubFetch.ts` was not changed. Timeouts and the 16 MiB cap remain. |
| M10 | Medium | **Still open** | `POST /marathon/sources` still pushes `osuText` into the JSON response (`routes/marathon.ts` 97–127). |
| L1 | Low | **Still open** | `createApp.ts` 42 still calls `decodeURIComponent(urlPathname)` with no try/catch. A path with a dangling `%` throws `URIError`. |
| L2 | Low | **Still open** | `resolveStaticFile` still uses `existsSync` + `statSync` (`createApp.ts` 49) on every static request. |
| L3 | Low | **Still fixed** (residual) | Most settings / practice / batch-collection strings still have `maxLength`. Residual: the two collection fields under M8. New `overlayOutput` is correctly capped at 128 in the PATCH schema (`settings.ts` 623) and in `OVERLAY_OUTPUT_MAX`. |
| L4 | Low | **Still fixed** | `listen.ts` + `armNodeListen` produce a clear `EADDRINUSE` path. Not runtime-verified in this pass. |
| L5 | Low | **Still open** | `GET /api/events` still `subscribe`s every client with no cap (`sse.ts` 154–182, `shared/events.ts` 32). |
| S-NEW-1 | Medium | **Still open** | `GET /sessions` without `day` still calls `listSessions(db)` with no limit (`routes/sessions.ts` 154–160). Day filter still passes `undefined` (`152`). `SessionsPage` still fetches that path and slices to 7 rows. |

---

## Recommended remaining order

1. **S-NEW-1** — restore a default cap (and a query `limit`) on `GET /api/sessions`. This is still the only behavioral regression vs `bc3eb6b` in this scope, and this commit did not touch it.
2. **M7** (desktop) — serialize `apply()`, **await** `stopChild` before spawn, cap and status-check `fetchOverlaySettings`. Do this before relying on the new monitor restart, or changing output can stack two HUDs.
3. **D-NEW-1** — add a recovery signal that is not a mid-map 30-minute exit (heartbeat, between-map recycle, or a “restart overlay” action).
4. **L7** — reuse `parseOverlayHostUrl` / `parseOverlayOutput` (or a small shared JS port) in the shell before building argv.
5. **M8** (desktop) — server child exit should not `app.exit` the whole desktop session.
6. **S-NEW-2** — validate the whole PATCH `/settings` body, then write in one transaction.
7. Then the unchanged server performance items (H2 allowlist, M2/M3/M4, calc-bundle count, marathon `osuText`, SSE cap, collection `maxLength`).
8. Then the low desktop leftovers (CSP, `sandbox`, log rotation, menu, launcher `cmdLine`).

---

## Still-open and new findings (full write-ups)

### S-NEW-1 — `GET /api/sessions` without `day` still returns every session

**Severity:** Medium (latency / memory on a long-lived library)  
**Status:** Still open — **not changed in `0d84595`**  
**Where:** `apps/server/src/analytics/session.ts` 648–682 (`listSessionsOnUtcDay`, `listSessions`); `apps/server/src/routes/sessions.ts` 146–160; `apps/server/public/features/sessions/SessionsPage.tsx` 20, 30, 34, 42; `apps/server/public/lib/api.ts` 323–333; `CommandPalette.tsx` 292

#### Root cause

`a07a7f5` made `limit` optional (“Omit `limit` to return every session”) and the HTTP handler started calling `listSessions(db)` and `listSessionsOnUtcDay(..., undefined, ...)` with no cap. That was a regression vs `listSessions(db, 100)` at `bc3eb6b`. This commit does not touch those files.

```146:160:apps/server/src/routes/sessions.ts
      if (day) {
        const items = await listSessionsOnUtcDay(db, day, undefined, tzOffset);
        // ...
      }
      const [items, current, activity] = await Promise.all([
        listSessions(db),
        getCurrentSession(db),
        getCalendarActivity(db, 371, tzOffset),
      ]);
```

`SessionsPage` initial load is still `fetchSessions(undefined, tzOffset)`, which omits `day`. The page only *renders* `DEFAULT_VISIBLE = 7` rows (`slice(0, DEFAULT_VISIBLE)`), but the payload is already complete. The command palette calls `fetchSessions()` with no arguments.

#### Impact

Thousands of sessions are serialized and sent on every visit to Sessions (and on `todayKey` change), and when the command palette warms that query. The SQLite + JSON + renderer cost is paid even if the user never clicks “show all”. This can stall the local API thread and the UI.

#### How to reproduce

1. Seed a DB with, say, 5,000 sessions.
2. `GET /api/sessions` (no `day`) — expect 5,000 items today; on `bc3eb6b` this was at most 100.
3. Open the Sessions page: the network tab shows the full list while the UI renders 7 rows.

#### Suggested change

Keep the optional helper, but do not default the HTTP handler to “all”.

```ts
const DEFAULT_SESSION_LIST = 100;
const MAX_SESSION_LIST = 500;

const limit = clampLimit(query.limit, DEFAULT_SESSION_LIST, MAX_SESSION_LIST);
if (day) {
  const items = await listSessionsOnUtcDay(db, day, limit, tzOffset);
  // ...
}
const items = await listSessions(db, limit);
```

Expose `limit` (later `cursor` / `before`) on the query string. For “show all”, paginate or use an explicit high cap. Client: pass a limit instead of downloading everything and slicing.

#### Trade-offs

A hard 100 cap hides older sessions until the user pages or filters by day — that was the previous, safer behavior. An uncapped “all” mode is fine if it is opt-in and itself capped.

#### Tests

- No query → at most `DEFAULT_SESSION_LIST` rows, even if the DB has more.
- `?limit=10` / `?limit=99999` (clamped).
- `?day=YYYY-MM-DD` also respects the default cap.
- Assert `listSessions(db)` (no second arg) is **not** used by the HTTP handler.

---

### D-NEW-1 — A visually dead overlay will not be respawned (`--watchdog-max-age-sec=0`)

**Severity:** Medium (user-visible, no automatic recovery)  
**Status:** Still open — spawn flag and supervision policy are unchanged  
**Where:** `apps/desktop/main.js` 517–525 (spawn argv and comment), 532–539 (exit log only), 625–626 (`childExited`); overlay-rs still treats `max_age_sec == 0` as “age cap off”

#### Root cause

The user-reported failure is a HUD that “dies”, slides left-to-right, then becomes noise pixels, while the **process can stay alive**. The shell still equates process liveness with overlay liveness:

```517:525:apps/desktop/main.js
  const args = [urlArg, "--watchdog-max-age-sec=0"];
  if (output) args.push(`--output=${output}`);
  // ...
  // Age cap is off: a 30-minute exit plus this respawn is a full HUD refresh
  // over the playfield. FD and RSS caps still exit 75 so a real leak recovers.
```

`decideOverlayApply` only respawns when `hasChild && childExited` (and the 15 s gap has passed), or when URL/output settings change. `childIsAlive` is `exitCode === null && signalCode === null`. A hung or visually corrupt WebKit/GTK layer never hits that path. FD/RSS watchdog exits still help only if those counters grow. The new monitor override can *move* the surface onto the right output on a clean restart; it cannot recover a process that is already painting garbage.

#### Impact

The HUD can stay as a broken layer over osu! until the user toggles overlay off/on, changes URL/monitor, or restarts the desktop app. A clean process crash is already respawned after the gap; this class of failure is not.

#### How to reproduce

Not reproduced here (no Wayland session). Suggested lab:

1. Packaged Linux, Wayland, overlay on. Confirm argv includes `--watchdog-max-age-sec=0`.
2. If the layer drifts or pixelates, `pgrep -a roxysu-overlay` — if the PID is unchanged, this finding applies.
3. Toggling the overlay or saving a different monitor should replace the PID; leaving it alone should not.

#### Suggested change

Pick a recovery signal that is **not** a hard mid-map exit:

1. Keep age off, but add a cheap liveness ping. If N pings fail, exit 75 or have the shell SIGTERM+respawn **between maps**.
2. Re-enable a long age cap (6–12 hours) as a backstop.
3. A tray / settings “restart overlay” that runs the serialized stop+start from desktop M7.

#### Trade-offs

A mid-map respawn flashes the HUD — that is why age was disabled. A between-map or heartbeat restart avoids that. A manual restart costs a click but is safe.

#### Tests

- Shell: a child that stays alive but stops answering a ping is restarted after the budget, and not during a simulated “in map” flag if that guard exists.
- Shell: process exit still respawns as today.

---

### M7 (desktop) — Overlay start/stop is still not serialized; `stopChild` is not awaited; settings body is uncapped

**Severity:** Medium  
**Status:** Still open — the new monitor restart is wired through the same unsynchronized `apply()`  
**Where:** `apps/desktop/main.js` 562–594 (`fetchOverlaySettings`), 614–669 (`apply`); `stopChild.js` 10–12 (5 s grace, 2 s kill deadline)

#### Root cause

`apply` is `async`, polled every 4 s (`OVERLAY_SETTINGS_POLL_MS`), and started with `void apply()` / `setInterval(() => void apply(), ...)`. There is still no `applying` / generation lock. On `stop` and on `spawn` with `stopRunning: true`:

```638:664:apps/desktop/main.js
    if (decision.action === "stop") {
      // ...
      stopChild(overlayChild, "overlay");
      overlayChild = null;
      overlayAppliedUrlArg = null;
      overlayAppliedOutput = null;
      return;
    }
    if (decision.action === "spawn") {
      // ...
      if (decision.stopRunning) stopChild(overlayChild, "overlay");
      overlayChild = null;
      spawnOverlayHost(paths, decision.urlArg, decision.output ?? null);
    }
```

`stopChild` returns a Promise (up to 7 s). It is not awaited. The shell immediately forgets the old `ChildProcess`, spawns a second host, and records the new URL/output as “applied”. Two `roxysu-overlay` processes can be alive at once — the old one still in its SIGTERM grace, the new one already mapped. Saving a monitor (`reason === "output-changed"`) is now a first-class way to take this path.

`fetchOverlaySettings` still:

- does not look at `res.statusCode`;
- concatenates every chunk into `raw` with no byte cap;
- treats a JSON body **without** an `overlay` key as `{ enabled: true, hostUrl: null, output: null }`, because `enabled` is `overlay.enabled !== false`.

A `500 { "error": "…" }` (or any other JSON error document) is therefore a successful “enable, use the default HUD URL” poll. That can **respawn** an overlay the user just turned off, instead of counting as a failed poll (F-066). A network error correctly resolves `null`. The bug is specifically parsing a non-2xx (or a 2xx error document) as settings.

#### Impact

Stacked HUDs over osu! (worse when changing monitor: one surface may linger on the old output while a new one appears on the new output). A wedged `/api/settings` stream can grow the main-process heap. A JSON error response can ignore a disable.

#### How to reproduce

1. Packaged Linux, Wayland, overlay enabled.
2. Save a different monitor (or flap the URL) and immediately `pgrep -a roxysu-overlay`. During the 5 s grace you can observe two PIDs.
3. Disable the overlay, then have `/api/settings` return HTTP 500 with body `{"error":"db"}`. The next poll can start the host again.
4. Separately, a large or non-JSON body should be ignored once a cap / status check exists.

#### Suggested change

1. Serialize `apply` with a generation counter and **await** `stopChild` before `spawnOverlayHost`. Drop a tick if a newer one is already queued.
2. In `fetchOverlaySettings`: require HTTP 200, cap `raw` (e.g. 64 KiB or the same 4 KiB pattern as `waitForServer.js` if the settings payload stays small — measure first; 64 KiB is safer), `req.destroy()` past the cap, keep the JSON `try/catch`.
3. Do not default `enabled` to true unless the parsed document actually contains `overlay`. A missing/invalid overlay object should resolve `null` (failed poll).

#### Trade-offs

Serialized apply can delay a start by one grace period (5 s). That is better than two HUDs, especially when the user just picked a monitor. A 64 KiB cap is far above a normal `/api/settings` JSON.

#### Tests

- Queue start→stop→start; assert `stopChild` was awaited and `spawn` ran once after stop settled.
- Overlapping `apply()` calls; only the latest generation’s decision wins.
- `fetchOverlaySettings`: HTTP 500 JSON ignored (does not enable); body > cap destroyed; valid JSON applied.
- Policy tests already cover output-changed (passed); add a clearing-output case (`appliedOutput: "DP-4"` → `output: null` → `output-changed`).

---

### L7 — Overlay `hostUrl` and `output` are still not re-validated in the shell

**Severity:** Low (server write path is solid; shell is defense in depth)  
**Status:** Still open; expanded to the new `--output` token  
**Where:** `apps/desktop/main.js` 575–581, 517–518; `overlayApplyPolicy.js` 88–92; server validators in `apps/server/src/overlayUrl.ts`

#### Root cause

PATCH `/settings` now validates both fields:

- `parseOverlayHostUrl` — http(s), no userinfo, length cap (`overlayUrl.ts` 10–28).
- `parseOverlayOutput` — trim, reject empty, length > 128, leading `-`, and `[\u0000-\u001F\u007F]` (`overlayUrl.ts` 35–43). Used at `settings.ts` 446–451. Schema `maxLength: 128` (`settings.ts` 623) matches `OVERLAY_OUTPUT_MAX`.

GET `/settings` (`readOverlayHostUrl` / `readOverlayHostOutput`, `settings.ts` 108–123) returns the raw trimmed DB value with **no** re-parse. The shell then:

```javascript
const urlArg = hostUrl === null ? input.defaultUrlArg : `--url=${hostUrl}`;
// ...
if (output) args.push(`--output=${output}`);
```

`spawn(..., args, { shell: false })` does not invoke a shell, and overlay-rs uses clap, so a value with spaces (`ZOWIE XL2546`) or an `=` is a single argv token and is not split into extra flags. `parseOverlayOutput` already rejects `--follow-focus=false` and embedded newlines. That is good for the normal PATCH path.

What remains: any value that reached the DB without PATCH (manual edit, older import, a future writer) is passed straight into WebKit’s URL (`--url=`) or the monitor matcher (`--output=`). The shell is the process that execs the host; it should apply the same rules.

#### Impact

Low on a stock UI. High only if settings are written out of band: the overlay host can be pointed at an arbitrary http(s) origin, or pinned to a nonsense monitor name.

#### How to reproduce

1. `PATCH /api/settings` with `overlayHostUrl=http://example.com/` — server accepts (http(s) is allowed). Confirm the shell spawns `--url=http://example.com/`. After the patch, reject non-loopback in the shell if that is the intended policy, or document that any http(s) URL is deliberate.
2. Write `overlay.host_output` in the DB to a leading-dash or control-character value, then poll: today the shell will still add `--output=…`. After the patch, it should ignore the value (treat as “follow osu!”) or refuse to spawn.

#### Suggested change

Share the parsers with the shell (small CommonJS port, or a tiny `@roxysu/overlay-url` package). If `parseOverlayHostUrl` fails, fall back to `OVERLAY_URL_DEFAULT` (or skip spawn and log). If `parseOverlayOutput` fails, spawn without `--output` and log. Optionally have GET `/settings` run the same parse so the UI does not display an unsavable value.

Do not implement a literal “pre-split on every `=`”. That comment in `main.js` 660–661 is stale; clap documents that `=` inside `--url=VALUE` is fine (`cli.rs` 24).

#### Trade-offs

A shared parser is a small dependency from Electron main into a TypeScript module (or a duplicated 20-line JS helper). Falling back to the default URL is safer than honoring a bad DB value; changing a user’s custom URL without a log would be surprising — log clearly.

#### Tests

- Shell (or a pure helper used by the shell): `file:///etc/passwd`, `http://user:pass@…`, overlong URLs, `--follow-focus=false`, `DP-4\n--url=http://evil` — none of these become spawn argv as written.
- Valid `DP-4` and `ZOWIE XL2546` still produce one `--output=…` token.
- Unit tests for `parseOverlayOutput` already cover the last two reject cases (passed). Add length > 128 and a value containing `=`.

---

### S-NEW-2 — `PATCH /api/settings` can commit earlier fields, then 400 on a later one

**Severity:** Low  
**Status:** New (pre-existing pattern; `overlayOutput` adds another mid-handler return)  
**Where:** `apps/server/src/routes/settings.ts` 352–467 (and later tosu / mania-rating branches)

#### Root cause

The PATCH handler writes as it goes, and returns 400 as soon as one field fails validation. Order around the new field:

1. scores filters, pause, `osuDataPath` (can already 400 after earlier writes)
2. `overlayEnabled` is upserted (`431–437`)
3. `overlayOutput` is parsed; on failure, **400 and return** (`439–451`)
4. `overlayHostUrl` is parsed; on failure, **400 and return** (`455–467`)
5. tosu / mania-rating / thresholds follow

There is no transaction and no “validate all, then write”. A single request `{ overlayEnabled: true, overlayOutput: "--bad", overlayHostUrl: "http://127.0.0.1:4321/#/overlay" }` will persist the enable flag, then fail, and leave the URL untouched. The official UI today sends enable, URL, and monitor as **separate** mutations (`OverlayHostSection.tsx` 59, 94, 136), so this is unlikely from the built-in form. The API still accepts a combined body (`api.ts` 858–865`).

#### Impact

A 400 response can still have changed the store. The client may show an error and stale settings until the next GET. A combined client (script, future form, or a retry that includes several dirty fields) can turn the overlay on, or pin a monitor, while believing the request failed.

#### How to reproduce

```bash
# assuming origin guard is satisfied (loopback, no Origin, or an allowed Origin)
curl -sS -X PATCH http://127.0.0.1:4321/api/settings \
  -H 'Content-Type: application/json' \
  -d '{"overlayEnabled":true,"overlayOutput":"--follow-focus=false"}'
# expect HTTP 400; then GET /api/settings — overlay.enabled may already be true
```

#### Suggested change

Validate every present field first, collecting errors (or fail on the first, but **without writes**). Then apply all upserts/deletes in one `db.transaction`. Keep the existing per-field 400 messages.

#### Trade-offs

A transaction is a small change in this codebase and matches user expectation for a single PATCH. Slightly longer handler; no partial settings events.

#### Tests

- Combined body with a valid enable and an invalid output: 400, `overlay.enabled` unchanged.
- Combined valid enable + output + URL: all three persist.
- Empty / null output still deletes the key and means “follow osu!”.

---

### M8 (desktop) — Server process exit still quits the whole desktop app

**Severity:** Medium  
**Status:** Still open — unchanged  
**Where:** `apps/desktop/main.js` 887–895

```887:895:apps/desktop/main.js
    serverChild.on("exit", (code, signal) => {
      if (!shuttingDown) {
        desktopLog(`server exited code=${code} signal=${signal}`);
        void shutdown().then(() => app.exit(code ?? 1));
      }
    });
    watchChildError(serverChild, "server", () => {
      if (!shuttingDown) {
        void shutdown().then(() => app.exit(1));
      }
    });
```

A server crash (OOM on S-NEW-1, unhandled exception, port conflict after a stale child) tears down Electron, the realm-reader, and the overlay. There is no respawn and no splash explaining that the server stopped.

**Suggested change:** show a “server stopped” splash, optionally respawn with the existing `respawnPolicy.js` backoff, and only `app.exit` if respawn is exhausted or the user quits. **Trade-off:** a tight crash loop can flap the UI; the policy already caps short-lived attempts. **Tests:** mock a server exit while `shuttingDown` is false and assert `app.exit` is not called on the first death if a respawn path exists.

---

### H2 — Settings can still `spawn()` any absolute regular file

**Severity:** treat as Medium unless an allowlist ships (was High; reduced by `assertSafeExecutablePath`)  
**Status:** Still open (reduced) — unchanged  
**Where:** `apps/server/src/executablePath.ts` 15; tosu / mania-rating settings writers; `executablePath.test.ts` passed

The helper still rejects relative paths, NUL/newlines, non-files, dangling links, and overlong paths. The file comment is explicit: “This does not stop a chosen binary.” A setting that points at any absolute regular file is still spawned. Origin guard makes remote abuse harder; a local writer can still get RCE.

**Suggested change:** allowlist well-known names (tosu, mania-rating trees under the data dir / bundled bits) or require the file to sit under a configured directory. **Trade-off:** users who drop a custom build in `/tmp` would have to move it. **Tests:** accept a file under the allowlisted root; reject `/etc/passwd` and a copied interpreter outside the root.

---

### M2 / M3 / M4 (server) — still request-thread / whole-library work

**Status:** Still open (M4 still reduced) — unchanged in this commit

- **M2** (`routes/beatmaps.ts` 409): preview still `readFileSync`s and parses the whole `.osu` on the request thread and returns every hit object. Move parse off-thread or stream a reduced preview; cap the number of objects returned.
- **M3** (`routes/skins.ts` 24, 150, 174): listing and zip still `readFileSync` + in-memory `zipSync`. Stream or cap archive size; avoid holding every asset as a `Uint8Array` at once.
- **M4** (`score-transfer/transfer.ts` 128–154): `loadIndex` still selects every score and every beatmap on preview and apply. The 256 MiB upload cap, unique dirs, write-CLI timeout, and shutdown discard remain. Page or filter the index; do not materialise the whole library to compute a transfer preview.

---

### M6 (server) — Collection match-cache is not drained on shutdown; no `unhandledRejection` handler

**Status:** Still open — unchanged  
**Where:** `startCollectionMatchCache` in `index.ts` 49 / `index.node.ts` 69; shutdown discards score-transfer uploads (`index.ts` 109) but never stops the cache; no `process.on("unhandledRejection")` on either entry

**Suggested change:** add a `stopCollectionMatchCache` (cancel timer, await in-flight refresh) and call it from both shutdown paths before `closeDb`. Add a process-level `unhandledRejection` logger (and exit in production if that is the project policy). **Tests:** after `stop`, a late refresh must not touch a closed DB.

---

### M7 (server) — `GET /settings/calc-bundle/status` still materialises every export row to count them

**Status:** Still open — unchanged  
**Where:** `routes/settings.ts` 239–243: `exportCount: (await exportCalcBundleEntries(db)).length`

**Suggested change:** a `COUNT(*)` / dedicated counter, or cache the length from the last export build. **Tests:** status does not call the full export serializer (spy or a large fixture that would be slow if still materialised).

---

### M8 (server) — Overlay skins PUT is still loosely typed; sprite count unbounded; some collection fields have no `maxLength`

**Status:** Still open (reduced) — unchanged  
**Where:** `overlay.ts` 211, 271 (`t.Any()`; per-sprite 8,000,000 cap); `collections.ts` 432–433, 607–608

**Suggested change:** type the skins body; cap the number of sprites and total bytes. Add `maxLength` to the single collection POST and PATCH, consistent with the batch route (200 / 2000). **Tests:** 8,001 sprites rejected; overlong collection name rejected.

---

### M10 — `POST /marathon/sources` still ships full `.osu` text in the JSON body

**Status:** Still open — unchanged  
**Where:** `routes/marathon.ts` 97–127 (`osuText` pushed into `sources`)

**Suggested change:** return a hash / path / id the client already has, or a short excerpt. If the editor needs the text, fetch it per-map from the existing beatmap route. **Tests:** response items have no `osuText` (or only a capped excerpt).

---

### L1 / L2 / L5 (server) — static path, stat, SSE cap

**Status:** Still open — unchanged

- **L1** (`createApp.ts` 42): wrap `decodeURIComponent` in try/catch; on `URIError` return 400 / fall through to index. Test: `GET /%` does not 500.
- **L2** (`createApp.ts` 49): `existsSync` + `statSync` on every static request. Use a small cache, or `open` + `fstat` once. Low priority.
- **L5** (`sse.ts` 154–182): cap concurrent subscribers (e.g. 16 or 32); over the cap return 503 and do not `subscribe`. Cleanup on abort is already correct. Tests: `cap+1` is 503; closing one frees a slot.

---

### L2 / L3 / L4 / L5 / L6 (desktop) — leftover hardening

**Status:** All still open — unchanged

- **L2:** add a CSP on `apps/server/public/index.html` (and/or a header in `createApp.ts`) that matches the Electron origin and the overlay hash routes. The splash CSP is not enough because it is replaced after `loadURL`.
- **L3:** set `webPreferences.sandbox: true` once preload and any native usage are confirmed compatible with Electron 45 sandbox. Test in a packaged Linux build.
- **L4:** rotate or cap `desktop.log` and child logs (`openChildLogFd` currently opens once in append mode and keeps the fd).
- **L5:** do not clear the application menu on macOS (`Menu.setApplicationMenu(null)` is still unconditional at `main.js` 833).
- **L6:** `roxysu_launcher.c` 59 still discards `cmdLine`. Forward a safe, allowlisted subset if Windows protocol/file association is required.

---

## Residual notes on fixed items (not re-opened)

- **Desktop M4 / server healthz:** add `service: "roxysu-server"` (or similar) to `GET /api/system/healthz` and require it in `waitForServer.js`.
- **Desktop M5:** macOS `activate` should re-check health or leave the splash visible on `loadAppIntoWindow` failure.
- **Desktop M2 leftover:** a destination allowlist for `open-external` is optional now that the sender is pinned.
- **Packaging:** `overlayApplyPolicy.js` is already in `apps/desktop/package.json` `files` and both Linux resource pack scripts — good; keep that list in sync.
- **Server H1 / L4:** `ROXYSU_HOST=localhost` is intentionally not loopback-only. Operators should bind `127.0.0.1` or `::1`.
- **Server M1:** missing `Origin` is allowed for loopback peers so the Electron shell and curl keep working. Do not widen that if you later bind a LAN address.
- **Server M5 / new output parser:** `parseOverlayOutput` is a good write-path filter (flags, controls, empty, length). Official UI saves monitor, URL, and enable separately, which avoids most of S-NEW-2. Policy tests for `output-changed` and unchanged monitor passed in this pass.
- **play-rune:** still not spawned or imported by `apps/desktop` or `apps/server/src`.

---

## Appendix: tests run (2026-11-23, Europe/Lisbon)

```
apps/desktop: bun test
  44 pass, 0 fail, 6 files (overlayApplyPolicy, paths.extract, respawnPolicy,
  stopChild, urlPolicy, waitForServer)

apps/server: bun test src/overlayUrl.test.ts src/executablePath.test.ts src/hubUrl.test.ts
  all of those tests passed (11 tests)

apps/server: bun test src/originGuard.test.ts
  did not run — Cannot find package 'elysia' (no node_modules in this worktree)
```

No Electron, Wayland, or large-library runtime was available, so apply-policy races, Plasma monitor placement, and the sessions-list regression were confirmed in source only.

---

*End of desktop + server review for `0d845951ffb59bb1b1e8486927f5f965311510a2`.*
