# Roxysu desktop + server — review of `aa5a12b` (`play/rune-migration`)

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Branch:** `play/rune-migration`  
**Commit reviewed:** `aa5a12b457630b1fb751fc61d2be8c4331d0228e`  
(“Add overlay settings management and validation for the in-game overlay host”, 2026-11-23 00:54 Europe/Lisbon)  
**Previous review tip:** `0d845951ffb59bb1b1e8486927f5f965311510a2`  
**Range:** 8 commits (`7eccb9d` … `aa5a12b`)  
**Worktree:** `/workspace/rx-desktop-server-aa5a12b` (detached HEAD; other worktrees were not touched)  
**Previous review:** `/workspace/Roxysu-desktop-server-review-0d84595.md`  
**This file:** `/workspace/Roxysu-desktop-server-review-aa5a12b.md`  
**Review date:** 2026-11-23 (Europe/Lisbon)

Read-only review. Nothing was pushed or modified in the worktree (tests were executed in-place with `bun test`). Suggested patches match the existing CommonJS / TypeScript style and are proposals only.

---

## Counts

Versus the `0d84595` desktop+server review:

| Area | Still fixed | Newly fixed this range | Partly fixed | Still open | New this range |
|------|-------------|------------------------|--------------|------------|----------------|
| Desktop | 7 | 3 (M7, M8, L7) | 1 (D-NEW-1) | 5 (L2–L6) | 1 (D-NEW-2) |
| Server | 6 | 2 (S-NEW-1, S-NEW-2) | 0 | 11 | 0 |
| **Total** | **13** | **5** | **1** | **16** | **1** |

**Totals at this tip:** 18 fixed, 1 partly fixed, 16 open, 1 new.

**Top 3 remaining issues**

1. **D-NEW-1** (Medium, partly fixed) — a visually dead overlay process is still not restarted automatically (`--watchdog-max-age-sec=0`). A Settings “Restart overlay” button now exists and works in policy tests; recovery still needs a click.
2. **D-NEW-2** (Medium, new) — a server child that stays alive but never passes healthz is stopped after 180 s, which counts as a “stable” run (`stableUptimeMs` is 60 s) and **resets** the respawn budget, so the shell never gives up.
3. **H2** (Medium, reduced) — settings can still `spawn()` any absolute regular file. Next among the unchanged server performance leftovers (M2/M3/M4, calc-bundle count).

---

## What was and was not verified

**Verified in source** at `aa5a12b`. Every item from `/workspace/Roxysu-desktop-server-review-0d84595.md` was re-checked against current file:line evidence. New code was reviewed for settings PATCH atomicity/validation, sessions list caps, and serialized overlay apply (errors, rapid toggles, quit during apply).

**Tests executed**

- `bun test` in `apps/desktop`: **89 pass, 0 fail** across 9 files, including the new `overlayApplyLoop`, `overlaySettings`, and `overlayUrlGuard` tests plus the expanded policy tests (restart nonce, clearing a monitor).
- Server route tests (`sessions.list.test.ts`, `settings.patch.test.ts`, `originGuard.test.ts`) were **not** executed: this worktree has no `node_modules` / `elysia`. Dependencies were not installed. Those tests were read in source; clamp and PATCH logic were reviewed against them.

**Not verified:** a live Electron 45 window, a Wayland / Plasma overlay session, a large session library against `GET /api/sessions`, concurrent PATCH races, a never-healthy server child, NSIS, or the Windows launcher. D-NEW-1 was not reproduced (no compositor on this box).

---

## What this range changed (desktop / server)

Relevant commits vs `0d84595`:

| Commit | Change |
|--------|--------|
| `7eccb9d` | Serialize overlay apply: `overlayApplyLoop.js` (`createApplyGate`, `executeOverlayDecision` awaits stop before spawn). |
| `aa5a12b` | Shell settings parse + 64 KiB cap + HTTP 200/`overlay.enabled` boolean (`overlaySettings.js`); argv re-check (`overlayUrlGuard.js`); restart nonce (`overlay.host_restart`, `overlayRestartHost`); sessions list caps + tests; PATCH validate-then-`db.transaction` + tests; server child respawn (M8); Nix / electron-builder file lists include the new modules. |

`index.html` gained a pre-paint language script, **not** a CSP. `dashboard.ts` now forwards `tzOffset` into `getPracticeSnapshot`. Analytics / judge / UI files also moved in this range; they were not prior findings and were not re-reviewed in depth here.

---

## Desktop — status of earlier findings

| ID | Previous severity | Status at `aa5a12b` | Evidence |
|----|-------------------|---------------------|----------|
| H1 | High | **Still fixed** | `attachWindowGuards` in `main.js` 244–257, wired at 359: `setWindowOpenHandler` denies new windows; `will-navigate` / `will-redirect` pin the window to `APP_ORIGIN`. `urlPolicy.test.js` passed. |
| M2 | Medium | **Still fixed** | `ipcSenderIsApp` (`main.js` 262–) still gates `open-external` (935) and `write-clipboard-image` (955). |
| M3 | Medium | **Still fixed** | `stopChild.js` unchanged (5 s grace, 2 s SIGKILL deadline). Overlay apply now **awaits** it (see M7). `before-quit` still uses `.finally()` (`main.js` 1138–1146). Tests passed. |
| M4 | Medium | **Still fixed** (residual) | `waitForServer.js` unchanged; wired with `startupAbort` (`main.js` 1057–1060, also used on server respawn at 590–592). Residual: `GET /api/system/healthz` is still `{ ok: true }` (`routes/system.ts` 77) with no `service` marker. |
| M5 | Medium | **Still fixed** (residual) | try/catch around `loadAppIntoWindow` (1074–1083), `.catch` on `whenReady` (1119–1127). Residual: macOS `activate` (1107–1117) still logs a failure and does not re-run `waitForServer`. |
| M6 | Medium | **Still fixed** | `ensureRealmExtracted` still awaited from `startRealmReader` (413). `paths.extract.test.js` passed. |
| M7 | Medium | **Fixed** (residual) | See write-up. Gate + awaited stop, 64 KiB cap, HTTP 200, `overlay.enabled` must be a boolean. Residual: `apply()` has no `catch` (an unexpected throw is an unhandled rejection after the gate is released). |
| M8 | Medium | **Fixed** (residual) | Unexpected server exit now goes through `scheduleServerRespawn` / `respawnPolicy.js` (`main.js` 508–610, 1051–1053) with a “Server stopped — restarting” splash. Give-up still `app.exit(1)` after a splash (559–567). See **D-NEW-2** for a budget-reset hole in the new path. Residual: after the UI has replaced the splash, `setSplashStatus` looks for `#status` and may no-op. |
| L1 | Low | **Still fixed** | `MAX_CLIPBOARD_IMAGE_BYTES` (`main.js` 68) and the sender/size checks (955, 964). |
| L2 | Low | **Still open** | `apps/server/public/index.html` still has no CSP (the +11 lines are a pre-paint `lang` script). No CSP header in the server. Only `splash.html` has a CSP, still replaced after `loadURL`. |
| L3 | Low | **Still open** | `webPreferences` is still only preload + `contextIsolation: true` + `nodeIntegration: false` (`main.js` 352–357). No `sandbox: true`. |
| L4 | Low | **Still open** | `desktopLog` still `appendFileSync`s to a single file (`main.js` 105). Child log fds are still opened once and reused (`openChildLogFd`, 132). |
| L5 | Low | **Still open** | `Menu.setApplicationMenu(null)` is still unconditional (`main.js` 1015). |
| L6 | Low | **Still open** | `roxysu_launcher.c` 56, 59 still discards `cmdLine`. |
| L7 | Low | **Fixed** (residual) | `guardOverlaySettings` (`main.js` 727–748) runs `parseOverlayHostUrl` / `parseOverlayOutput` from `overlayUrlGuard.js` before argv is built. Rejected URL → default HUD; rejected monitor → follow osu!; both logged. Tests passed (including `=`, overlong, flags, controls). Residual: GET `/settings` still returns raw DB values; the shell is now the check. |
| D-NEW-1 | Medium | **Partly fixed** | Manual “Restart overlay” nonce (`overlay.host_restart` / `overlayRestartHost`) plus policy `restart-requested` (bypasses the gap). Spawn argv still includes `--watchdog-max-age-sec=0` (`main.js` 649). No ping / age cap / between-map recycle. |

---

## Server — status of earlier findings

| ID | Previous severity | Status at `aa5a12b` | Evidence |
|----|-------------------|---------------------|----------|
| H1 | High | **Still fixed** | `resolveListen()` still defaults to `127.0.0.1` (`listen.ts` 2, 19). Both entry points use it (`index.ts` 38, `index.node.ts` 38). `localhost` warning unchanged (`listen.ts` 37). |
| H2 | High | **Still open** (reduced) | `assertSafeExecutablePath` is still used on tosu / mania-rating paths during PATCH validation (`settings.ts` 543, 570) *before* the transaction. Any absolute regular file can still be stored and later spawned. |
| M1 | Medium | **Still fixed** | `originGuard()` still used from `app.ts` 14 and `createApp.ts` 91. Unit tests not executed (no `elysia`). The guard itself was not changed in this range. |
| M2 | Medium | **Still open** | `routes/beatmaps.ts` 409 still `readFileSync` + parse on preview. |
| M3 | Medium | **Still open** | `routes/skins.ts` 24, 150, 174 still `readFileSync` + in-memory `zipSync`. |
| M4 | Medium | **Still open** (reduced) | `loadIndex` still selects every score and every beatmap (`transfer.ts` 128–154). |
| M5 | Medium | **Still fixed** | `parseOverlayHostUrl` / `parseOverlayOutput` still used on PATCH, now only to *plan* writes (`settings.ts` 473, 491). |
| M6 | Medium | **Still open** | `startCollectionMatchCache` in `index.ts` 49 / `index.node.ts` 69; shutdown still only `discardScoreTransferUploads` (`index.ts` 109). No `unhandledRejection` handler on either entry. |
| M7 | Medium | **Still open** | `GET /settings/calc-bundle/status` still does `(await exportCalcBundleEntries(db)).length` (`settings.ts` 256). |
| M8 | Medium | **Still open** (reduced) | Overlay skins PUT still `{ body: t.Any() }` (`overlay.ts` 211, 271) with a per-sprite 8,000,000 cap. Single collection POST name/query still only `minLength: 1` (`collections.ts` 432–433); PATCH at 607–608 still lack `maxLength`. |
| M9 | Medium | **Still fixed** | `hubFetch.ts` was not changed. |
| M10 | Medium | **Still open** | `POST /marathon/sources` still includes `osuText` (`marathon.ts` 97–127). |
| L1 | Low | **Still open** | `createApp.ts` 42 still `decodeURIComponent` without try/catch. |
| L2 | Low | **Still open** | `resolveStaticFile` still `existsSync` + `statSync` (`createApp.ts` 49). |
| L3 | Low | **Still fixed** (residual) | Same collection-field residual as M8. `overlayOutput` still capped at 128 (`settings.ts` 714). |
| L4 | Low | **Still fixed** | `listen.ts` / `armNodeListen` unchanged. |
| L5 | Low | **Still open** | `GET /api/events` still `subscribe`s every client (`sse.ts` 182). |
| S-NEW-1 | Medium | **Fixed** (residual) | Handler always passes `clampSessionListLimit` (default 100, max 500) into both list branches (`sessions.ts` 58–64, 166–178). Clients: Sessions page default query relies on the server default; “Show all” fetches 500; command palette requests 100. Residual: list payload has no `hasMore`/`total`; a calendar day still defaults to 100 with no day-level “show all”. |
| S-NEW-2 | Low | **Fixed** | PATCH `/settings` validates every present field, then `db.transaction` (`settings.ts` 368–662). Side effects (osu path cache, tosu restart, cache invalidation) run only after commit (664–685). Tests in `settings.patch.test.ts` cover the exact previous repro (not executed here). |

---

## Recommended remaining order

1. **D-NEW-1** — keep the new Restart button, but add an automatic recovery signal (heartbeat, between-map recycle, or a long age cap). The reported drift/noise failure still needs a click.
2. **D-NEW-2** — a live-but-never-healthy server must not reset the respawn counter. Count the 180 s `waitForServer` failure as a short-lived run, or time uptime from “healthz ok”, not from `spawn()`.
3. Then the unchanged server leftovers: **H2** allowlist, **M2/M3/M4** request-thread / whole-library work, calc-bundle count (**server M7**), marathon `osuText`, SSE cap, collection `maxLength`.
4. Then desktop leftovers: CSP (**L2** — the new inline `lang` script will need a nonce or to move out of a `script` block), `sandbox`, log rotation, macOS menu, launcher `cmdLine`.
5. Small residuals on the fixes: `apply()` `catch`, list `hasMore`, splash `#status` after the UI has loaded, healthz `service` marker.

---

## Newly fixed, partly fixed, and new findings

### M7 (desktop) — Overlay apply is serialized; `stopChild` is awaited; settings poll is capped and status-checked

**Severity:** Medium  
**Status:** **Fixed** (residual)  
**Where:** `apps/desktop/overlayApplyLoop.js`, `overlaySettings.js`, `main.js` 697–846

#### What was fixed

The three holes from the previous review are addressed in source and covered by unit tests (all passed):

1. **One apply in flight.** `createApplyGate` (`overlayApplyLoop.js` 42–60): a poll mid-flight coalesces into a single follow-up that re-fetches settings, so a rapid toggle or a monitor save during a 5–7 s stop is not dropped and does not start a second host. Combined-shape test in `overlayApplyLoop.test.js` 118–141 passed.
2. **Stop completes before spawn.** `executeOverlayDecision` awaits `deps.stop()` when `action === "stop"` or `stopRunning` (`overlayApplyLoop.js` 75–84). `main.js` 820–830 injects `stopChild` and only then `spawnOverlayHost`. Bookkeeping for a stop (`overlayChild = null`, applied URL/output cleared) happens **after** the awaited stop (832–836).
3. **Trustworthy settings poll.** `fetchOverlaySettings` uses `readCappedBody` (64 KiB) and `parseOverlaySettingsResponse` (`main.js` 697–715; `overlaySettings.js`). Non-200, invalid JSON, a missing `overlay` object, or a non-boolean `enabled` is a failed poll (`null`), not “enabled with the default URL”. A 500 `{"error":"db"}` can no longer respawn a host the user just disabled.

#### Edge cases reviewed (errors, rapid toggles, quit)

- **Rapid toggles:** extra `apply()` calls during flight return at `begin()` and set `coalesced`. `end()` triggers exactly one re-run, which reads fresh settings. Good.
- **Quit during apply:** `shutdown()` (`main.js` 899–931) sets `shuttingDown`, clears the poll timer, and `stopChild`s the current overlay. `apply` bails after fetch if `shuttingDown`; the spawn callback also bails (`823`). `finally` will not re-schedule (`838`). Concurrent `stopChild` on the same process is the already-safe M3 path. If shutdown nulls `overlayChild` first, apply’s `stop: () => stopChild(overlayChild, …)` may see `null` and no-op; shutdown already holds the real handle.
- **Errors:** there is no `catch` around the `try` in `apply()` (`773–841`). `finally` still releases the gate (and may re-run). `fetchOverlaySettings` / `stopChild` are written to resolve rather than throw, so this is unlikely in the normal path, but an unexpected throw from `spawn()` or `desktopLog` would be an **unhandled rejection** from `void apply()`. Residual: wrap the body in `catch` and log.

#### Residual / tests to add

- `apply()` `catch` that logs and does not skip `end()`.
- Optional: a test that `shuttingDown` during `await stop()` does not spawn (the main.js wiring is not in the pure loop tests).

---

### L7 — Overlay `hostUrl` and `output` are re-validated in the shell

**Severity:** Low  
**Status:** **Fixed** (residual)  
**Where:** `apps/desktop/overlayUrlGuard.js`; `guardOverlaySettings` in `main.js` 727–748

Rules are a documented mirror of `apps/server/src/overlayUrl.ts` (http(s), no userinfo, output: no leading `-`, no controls, max 128). `spawn` still uses `shell: false` and one `--url=` / `--output=` token; clap keeps `=` inside the value (`overlayUrlGuard.test.js` covers `DP-4=2`). New modules are in `package.json` `files`, both Linux pack scripts, and `nix/package.nix` 354–356.

**Residual:** GET `/settings` still returns the raw trimmed DB value (`readOverlayHostUrl` / `readOverlayHostOutput`). The shell now drops a bad value. Optionally parse on GET so the UI does not display an unsavable monitor.

---

### S-NEW-1 — `GET /api/sessions` is capped again

**Severity:** Medium  
**Status:** **Fixed** (residual)  
**Where:** `apps/server/src/routes/sessions.ts` 52–64, 166–192; `sessions.list.test.ts`; `SessionsPage.tsx` 20–45, 74; `CommandPalette.tsx` 294; `api.ts` 326–336

The handler never calls `listSessions(db)` or `listSessionsOnUtcDay(..., undefined, ...)`:

```168:178:apps/server/src/routes/sessions.ts
      const limit = clampSessionListLimit(query.limit);
      if (day) {
        const items = await listSessionsOnUtcDay(db, day, limit, tzOffset);
        // ...
      }
      const [items, current, activity] = await Promise.all([
        listSessions(db, limit),
```

`clampSessionListLimit`: missing / non-finite / `< 1` → 100; otherwise `min(floor(n), 500)`. The default path (no `limit` query) is 100, restoring the pre-`a07a7f5` cap. “Show all” is a second query with `SHOW_ALL_LIMIT = 500`. The palette passes `100` explicitly.

`sessions.list.test.ts` (read, not executed) seeds 120 rows and asserts: no query → 100; `?limit=5` → 5; `?day=` → 100; `?limit=99999` → 120 (the seed, i.e. not unbounded). It does not seed more than 500, so the hard clamp is not proven by that fixture — the clamp function itself is straightforward.

#### Residuals

- The list payload has no `hasMore` / `total`. If the library has 600 sessions, “Show all” silently stops at 500.
- A selected calendar day uses the default 100 and has no day-level “show all” (`SessionsPage.tsx` 41–44, 49). A very busy day can hide later sessions.
- Suggested follow-up: `hasMore` (fetch `limit+1` as the score detail route already does) and `?limit=` on the day query when the user asks for more.

---

### S-NEW-2 — `PATCH /api/settings` validates first, then writes in one transaction

**Severity:** Low  
**Status:** **Fixed**  
**Where:** `apps/server/src/routes/settings.ts` 365–687; `settings.patch.test.ts`

Writes are planned in a `writes` / `maniaPaths` list. Any validation failure (`parseOverlayOutput`, `parseOverlayHostUrl`, `validateOsuDataPath`, `assertSafeExecutablePath`, etc.) returns 400 **before** `db.transaction`. The transaction applies every planned upsert/delete (and mania-rating paths) or none. In-process caches and `restartTosuAdapter` run only after a successful commit.

`overlayRestartHost` bumps `overlay.host_restart` with `Math.max(Date.now(), (prev ?? 0) + 1)` so sequential rapid clicks stay monotonic (test included). Official UI still mostly PATCHes one field at a time, plus the new restart button.

**Residual (low, not re-opened):** two concurrent PATCHes could both read the same `prev` nonce before either commits; the UI disables the button while pending, so this is unlikely. `settings.patch.test.ts` was not executed here (no `elysia` / DB client install).

---

### M8 (desktop) — Server process exit no longer quits the desktop app on the first death

**Severity:** Medium  
**Status:** **Fixed** (residual; see also D-NEW-2)  
**Where:** `apps/desktop/main.js` 508–610, 1051–1053

`spawnServer` on `exit` / spawn `error` calls `scheduleServerRespawn` instead of `shutdown()` + `app.exit`. The policy is the existing `respawnPolicy.js` (2 s … 60 s, 6 short-lived attempts, 60 s stable uptime resets the counter). A “Server stopped — restarting” splash is requested; after healthz succeeds, `loadAppIntoWindow` reloads. A stale `waitForServer` is abandoned via `serverWaitId`. Replaced children (`child !== serverChild`) do not schedule a respawn.

**Residuals**

- After the budget is exhausted, the shell still shows “Server stopped — see logs”, shuts down, and `app.exit(1)` (559–567). That is intentional, but see **D-NEW-2**.
- `setSplashStatus` writes `#status` in the current window (`853–868`). Once the app UI has replaced the splash, that node is gone, so the user may see no message during a mid-session respawn.
- First-boot `waitForServer` failure still exits (1061–1067) — that is startup, not this finding.

---

### D-NEW-1 — A visually dead overlay is still not restarted automatically

**Severity:** Medium  
**Status:** **Partly fixed**  
**Where:** spawn `main.js` 649–657; policy `overlayApplyPolicy.js` 96–122, 135–154; settings key `OVERLAY_HOST_RESTART_KEY`; PATCH `overlayRestartHost` (`settings.ts` 504–515); UI `OverlayHostSection.tsx` 159–165

#### What was fixed

The previous review’s option 3 (a manual restart) shipped. `PATCH { overlayRestartHost: true }` bumps a monotonic nonce; GET `/settings` exposes it as `overlay.restartAt`; the shell records `overlayAppliedRestartAt` at spawn; a new nonce is `reason: "restart-requested"`, `stopRunning: true`, and bypasses the 15 s liveness gap. Disabled hosts ignore a nonce. Policy tests for these cases passed.

#### What is not fixed

```649:657:apps/desktop/main.js
  const args = [urlArg, "--watchdog-max-age-sec=0"];
  // Age cap is off: a 30-minute exit plus this respawn is a full HUD refresh
  // over the playfield. FD and RSS caps still exit 75 so a real leak recovers.
```

The shell still equates process liveness (`childIsAlive`) with overlay liveness. A WebKit/GTK layer that drifts or turns into noise while the process stays up will sit there until the user clicks **Restart overlay**, changes URL/monitor, or the process exits (FD/RSS watchdog). There is still no ping, between-map recycle, or long age cap.

#### Impact

The reported “died … noise pixels” failure is now recoverable without quitting Roxysu, but it is not self-healing.

#### Suggested change (unchanged remainder)

Keep age off during a map if a mid-play flash is unacceptable, but add a cheap liveness ping and recycle between maps, or a 6–12 hour age backstop. The new restart button should stay either way.

#### Tests already present / still useful

- Policy and PATCH nonce tests exist (policy tests passed). A live ping-failure restart remains untested and unimplemented.

---

### D-NEW-2 — A live-but-never-healthy server resets the respawn budget

**Severity:** Medium (new hole in the M8 respawn path)  
**Status:** New  
**Where:** `apps/desktop/main.js` 586–600 (`respawnServer`); `respawnPolicy.js` 14–22, 36 (`stableUptimeMs: 60000`); `waitForServer` timeout 180_000 ms

#### Root cause

When a respawned server process stays alive but never returns HTTP 200 `{ ok: true }` on `/api/system/healthz`, `respawnServer` waits up to **180 s**, then stops the child so its `exit` event drives the next policy round:

```591:599:apps/desktop/main.js
    await waitForServer(PORT, HOST, 180_000, { signal: startupAbort.signal });
  } catch (err) {
    // ...
    if (childIsAlive(serverChild)) void stopChild(serverChild, "server");
    return;
  }
```

`scheduleServerRespawn` then computes `uptimeMs: Date.now() - serverSpawnedAt`. That uptime is ~180 s, which is **greater than** `stableUptimeMs` (60 s), so `decideRespawn` treats the run as stable and sets `failures` back to 1:

```36:36:apps/desktop/respawnPolicy.js
  const failures = (uptimeMs >= cfg.stableUptimeMs ? 0 : previous) + 1;
```

The shell never reaches `give-up`. It will keep spawning a broken server, waiting three minutes, killing it, and trying again (with only the 2 s first-delay). A server that *dies quickly* still backs off and gives up after 6 attempts — that path is fine and is covered by `respawnPolicy.test.js`.

#### Impact

A packaged install whose server binds but never becomes healthy (bad static dir, wedged DB, healthz stuck) can loop forever: CPU, log growth (L4 is still uncapped), and a window that never stays on the UI. The “giving up — restart Roxysu” message never appears.

#### How to reproduce

Not runtime-verified here. Suggested lab: start the desktop app with a server entry that listens on the port but never serves `/api/system/healthz` as `{ ok: true }`. After several 180 s cycles, `desktop.log` should still show `server respawn #1` (or a low number), not `giving up after 6`.

#### Suggested change

Count “spawned but never healthy” as a short-lived failure, regardless of wall-clock time:

- Record `serverHealthyAt` when `waitForServer` succeeds; pass `uptimeMs: serverHealthyAt ? now - serverHealthyAt : 0` (or `0` if health never arrived) into `decideRespawn`.
- Or pass a `healthy: false` flag / `uptimeMs: 0` from the `waitForServer` catch before `stopChild`.
- Optionally use a shorter health timeout on *respawn* than on first boot (e.g. 30 s) so a broken loop is obvious sooner.

#### Trade-offs

A slow-but-honest migrate on respawn could be killed earlier if the health timeout is shortened; tying the stable clock to “healthz ok” avoids that and still fixes the reset.

#### Tests

- `decideRespawn` already covers stable-reset vs give-up. Add a shell-level (or extracted) test: `waitForServer` failure after 180 s with a still-alive child increments `failures` instead of resetting them; six such rounds give up and do not schedule another timer.

---

## Still-open findings (unchanged in this range)

These were re-checked; behavior and line numbers are current, but the substance is the same as in the `0d84595` review.

### H2 — Settings can still `spawn()` any absolute regular file

`assertSafeExecutablePath` still rejects relative paths, NULs, non-files, and overlong paths, and PATCH now validates *before* the transaction (`settings.ts` 543, 570). The helper still does not restrict *which* absolute file. Allowlist a data-dir / bundled tree.

### M2 / M3 / M4 (server) — request-thread / whole-library work

- **M2** (`beatmaps.ts` 409): preview still parses the whole `.osu` on the request thread.
- **M3** (`skins.ts` 24, 150, 174): still `readFileSync` + in-memory `zipSync`.
- **M4** (`transfer.ts` 128–154): `loadIndex` still selects every score and every beatmap.

### M6 (server) — Collection match-cache is not drained on shutdown; no `unhandledRejection` handler

`startCollectionMatchCache` (`index.ts` 49, `index.node.ts` 69) still has no stop in shutdown. Score-transfer uploads are still discarded. No process-level `unhandledRejection` on either entry.

### M7 (server) — `GET /settings/calc-bundle/status` still materialises every export row

`settings.ts` 256: `exportCount: (await exportCalcBundleEntries(db)).length`. Use a counter or cache.

### M8 (server) — Overlay skins PUT is loosely typed; some collection fields have no `maxLength`

`overlay.ts` 211, 271 (`t.Any()`, per-sprite cap, unbounded sprite count). `collections.ts` 432–433 and 607–608 still lack `maxLength`.

### M10 — `POST /marathon/sources` still ships full `.osu` text

`marathon.ts` 97–127 still pushes `osuText` into the JSON body.

### L1 / L2 / L5 (server) — static path, stat, SSE cap

- **L1** (`createApp.ts` 42): wrap `decodeURIComponent`; a dangling `%` still throws `URIError`.
- **L2** (`createApp.ts` 49): `existsSync` + `statSync` on every static request.
- **L5** (`sse.ts` 182): no cap on concurrent SSE subscribers.

### L2 / L3 / L4 / L5 / L6 (desktop) — leftover hardening

- **L2:** still no CSP on the real UI. The new pre-paint `lang` script in `index.html` is inline; when a CSP is added, give it a nonce or move the logic out of an inline script.
- **L3:** still no `sandbox: true` (`main.js` 352–357).
- **L4:** no rotation or size cap on `desktop.log` or child logs.
- **L5:** `Menu.setApplicationMenu(null)` is still unconditional (`main.js` 1015).
- **L6:** Windows launcher still discards `cmdLine`.

---

## Residual notes on fixed items (not re-opened)

- **Desktop M4 / healthz:** add `service: "roxysu-server"` and require it in `waitForServer.js`. This also makes a never-healthy impostor less likely to look “ok” (related to M4, not D-NEW-2).
- **Desktop M5:** macOS `activate` should re-check health or leave a splash visible on `loadAppIntoWindow` failure.
- **Packaging:** `overlayApplyLoop.js`, `overlaySettings.js`, and `overlayUrlGuard.js` are in `package.json` `files`, both Linux pack scripts, and `nix/package.nix` — good; keep that list in sync.
- **Server H1 / L4:** `ROXYSU_HOST=localhost` is still not loopback-only.
- **Server M1:** missing `Origin` is still allowed for loopback peers.
- **play-rune:** still not spawned or imported by `apps/desktop` or `apps/server/src`.

---

## Appendix: tests run (2026-11-23, Europe/Lisbon)

```
apps/desktop: bun test
  89 pass, 0 fail, 9 files
  (overlayApplyLoop, overlayApplyPolicy, overlaySettings, overlayUrlGuard,
   paths.extract, respawnPolicy, stopChild, urlPolicy, waitForServer)

apps/server: sessions.list.test.ts, settings.patch.test.ts, originGuard.test.ts
  not executed — no node_modules / elysia in this worktree
```

No Electron, Wayland, or large-library runtime was available. Serialized apply, PATCH atomicity, and the sessions cap were confirmed in source (and, for the desktop helpers, by unit tests). D-NEW-2 was not runtime-reproduced.

---

*End of desktop + server review for `aa5a12b457630b1fb751fc61d2be8c4331d0228e`.*
