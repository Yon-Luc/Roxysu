# Roxysu Electron desktop app — in-depth issue analysis

**Repository:** https://github.com/Yon-Luc/Roxysu  
**Default branch reviewed:** `master`  
**Commit:** `bc3eb6be1eba43cd6c146e6da42924bc1f4f83e7`  
(“Update the docs site download links to v0.1.23.”, 2026-11-03 16:34 Europe/Lisbon)  
**App version:** `0.1.23` (`apps/desktop/package.json`)  
**Electron:** `45.2.1`  
**Review date:** 2026-11-17  
**Clone used:** `/workspace/Roxysu` (read-only; this document lives outside the repo)

This document expands every finding from the desktop-shell review: High #1, Medium #2–#8, and each Low item. Line numbers refer to that commit. Suggested patches are written to match the existing CommonJS / JSDoc style in `apps/desktop`. They are proposals only — nothing in the repo was modified.

---

## What was and was not verified

**Verified in source (this commit):** every issue below was re-read in the files cited. Two small Node probes were also run on the review machine (not inside Electron):

1. `http.get({ timeout })` followed by `req.destroy()` in the `'timeout'` handler also emits `'error'` with `ECONNRESET`. That confirms the double-`retry()` path in `waitForServer`.
2. `spawn()` of a missing binary emits `'error'` with `ENOENT`, sets `exitCode` to `-2`, and does **not** emit `'exit'`. Overlay/realm spawn-error handling that keys off `exitCode !== null` is therefore consistent with current Node behavior.

**Not verified (do not treat these as runtime measurements):**

- The packaged app, NSIS installer, portable build, and Windows launcher were not run.
- No live Electron 45 window was opened, so child-window preload inheritance and macOS menu-role behavior are based on Electron’s documented defaults plus the absence of the usual guards in this tree, not a click-through test.
- Realm tarball extract time and archive size were not measured. The first-run freeze follows from `execFileSync` on the main process; duration is inferred from comments in `paths.js` (“one file vs ~GB of natives”), not a benchmark.
- The Wayland overlay host was not spawned. The `apply()` race is a control-flow finding.
- The `stopChild` hang is a real race in the code; it was not reproduced as a stuck Quit in a running app (the window is narrow).
- This is not a full audit of the React UI. `apps/desktop/renderer.js` is a dev smoke page and is not packaged. Desktop-specific renderer issues called out here are navigation / `window.open` / CSP only.
- `@elysiajs/node` behavior on `EADDRINUSE` was not executed. The desktop bug (treating any HTTP status below 500 as “our server”) holds regardless.

**Already addressed in this commit (do not re-fix):** quit now waits for children (`before-quit` + `preventDefault` + SIGKILL grace); child `'error'` listeners exist; child log fds are reused per label; realm-reader respawn has backoff and retries extract/entry failures; overlay policy treats signal death as dead and stops a host after repeated poll failures.

---

## Summary table

| ID | Severity | Title | Primary file | Effort |
|----|----------|-------|--------------|--------|
| H1 | High | No navigation / `window.open` allowlist; preload can follow the user off localhost | `apps/desktop/main.js` | Medium (half day), share helpers with M2 |
| M2 | Medium | IPC does not check the sender; `openExternal` accepts any http(s) URL | `apps/desktop/main.js`, `preload.js` | Small (1–2 h), land with H1 |
| M3 | Medium | `stopChild` can hang forever; `before-quit` then never finishes | `apps/desktop/main.js` | Small (1–2 h) + a unit test if extracted |
| M4 | Medium | `waitForServer` double-retries, never cancels, and treats any HTTP status below 500 as the app | `apps/desktop/main.js` | Medium (half day) |
| M5 | Medium | Startup / reload errors are unhandled; a failed `loadURL` leaves the splash up | `apps/desktop/main.js` | Small (1–2 h) |
| M6 | Medium | First-run realm extract blocks the Electron main process | `apps/desktop/paths.js`, `main.js` | Medium (half day) |
| M7 | Medium | Overlay `apply()` is not serialized and does not await `stopChild` | `apps/desktop/main.js` | Small–medium (2–4 h) |
| M8 | Medium | A server child exit tears down the whole desktop app, with no respawn | `apps/desktop/main.js` | Medium–large (policy + UX) |
| L1 | Low | `writeClipboardImage` has no size limit | `apps/desktop/main.js` | Small; land with M2 |
| L2 | Low | No Content-Security-Policy on the real UI | `apps/server/public/index.html` | Medium (policy must not break fonts / API / overlay) |
| L3 | Low | `webPreferences.sandbox` is not enabled | `apps/desktop/main.js` | Small, plus a preload smoke test |
| L4 | Low | Desktop and child logs grow without rotation | `apps/desktop/main.js` | Small |
| L5 | Low | `Menu.setApplicationMenu(null)` drops macOS standard roles | `apps/desktop/main.js` | Small; low priority (macOS is not a shipping target) |
| L6 | Low | Windows launcher drops command-line arguments | `apps/desktop/launcher/win/roxysu_launcher.c` | Small (C change + rebuild) |
| L7 | Low | Overlay `hostUrl` is not re-validated in the shell | `apps/desktop/main.js`, `apps/server/src/routes/settings.ts` | Small; can share URL helpers with H1 |

---

## App structure

Roxysu is a monorepo. The Electron app in `apps/desktop` is a thin shell around the same local stack the browser uses: a Node API + React UI (`apps/server`) and a Realm-to-SQLite sync process (`apps/realm-reader`). On Linux/Wayland it may also spawn the optional in-game overlay host.

```
osu!lazer (client.realm, read-only)
        |
apps/realm-reader  -->  SQLite
        |
apps/server (HTTP + SSE + React UI)  <--  Electron window (loadURL http://127.0.0.1:4321/)
        |
optional: roxysu-overlay (Wayland)
```

| Piece | Role |
|-------|------|
| `apps/desktop/main.js` | Main process: single-instance lock, splash `BrowserWindow`, child spawns, IPC, shutdown, auto-update kickoff |
| `apps/desktop/preload.js` | `contextBridge.exposeInMainWorld("roxysuDesktop", { platform, versions, openExternal, writeClipboardImage })` |
| `apps/desktop/paths.js` | Packaged vs dev layouts; synchronous realm tarball extract into userData |
| `apps/desktop/auto-update.js` | `electron-updater`, Windows NSIS installs only |
| `apps/desktop/respawnPolicy.js` | Pure realm-reader backoff / give-up (unit-tested) |
| `apps/desktop/overlayApplyPolicy.js` | Pure overlay spawn/stop/respawn decisions (unit-tested) |
| `apps/desktop/splash.html` | Startup splash (packaged; has a CSP) |
| `apps/desktop/index.html` + `renderer.js` | Nix/dev smoke test only — **not** in electron-builder `files` |
| Product renderer | React UI from `apps/server`, loaded at `http://127.0.0.1:4321/` (or `ROXYSU_HOST` / `ROXYSU_PORT`) |
| Desktop UI hooks | `apps/server/public/lib/desktop.ts`, `features/hub/HubLoginButton.tsx`, `lib/sessionShareImage.ts` |
| Build | `package.json` `build` + `scripts/build-pack.mjs`, `after-pack.mjs`; Windows C launcher `launcher/win/roxysu_launcher.c`. Server, UI, bundled Node, and `realm-reader.tgz` ship as `extraResources`. |

Security baseline that is already in good shape: `contextIsolation: true`, `nodeIntegration: false`, `openExternal` limited to the `http:` / `https:` schemes, splash CSP, single-instance lock, cooperative child shutdown.

The product targets Windows (NSIS + portable) and uses NixOS/Linux for packaging and smoke-testing (`package.json` description). macOS code paths (`activate`, Application Support) exist but macOS is not described as a shipping platform.

---

## Recommended fix order

Land security and “app won’t quit / won’t start cleanly” items first. Several share a small URL / origin helper, so group them.

1. **H1 + M2 + L1** — navigation / window-open guards, IPC sender checks, clipboard size cap. One PR. This is the only High, and M2/L1 are the same surface.
2. **M3** — make `stopChild` always resolve. Small, prevents a stuck Quit, and M7’s `await stopChild` depends on it not hanging.
3. **M5** — try/catch around `whenReady` / `activate` / `loadURL`. Small and unblocks clearer startup failures.
4. **M4** — harden `waitForServer` (settled flag, abort, authentic health check). Complements M5 and M8.
5. **L7** — re-validate overlay URLs in the shell (can reuse H1 helpers). Cheap if the helper already exists.
6. **M6** — async realm extract so first packaged launch does not freeze the window.
7. **M7** — serialize overlay `apply()`, await stop, cap the settings body.
8. **L2 + L3** — CSP on the real UI and `sandbox: true`. Hardening; test carefully with Google Fonts, `/api/*`, and the overlay hash route.
9. **L4** — log rotation. Quality of life, no user-facing failure.
10. **M8** — server respawn or a reconnect splash. This is a product-policy change, not a one-line fix; do it once the startup/shutdown path is solid.
11. **L5, L6** — macOS menu and Windows launcher argv. Only if you care about those platforms / deep links.

Suggested grouping if you want fewer PRs: (H1+M2+L1+L3+L7), (M3+M5+M4), (M6), (M7), (L2), (L4), (M8), (L5/L6).

---

## H1 — No navigation / `window.open` allowlist; preload can follow the user off localhost

**Severity:** High (security + user-visible navigation)

### Where

`apps/desktop/main.js` creates one `BrowserWindow` with a preload and never installs `setWindowOpenHandler`, `will-navigate`, or `will-redirect`. A repo-wide search of `apps/desktop` and `apps/server` finds none of those APIs.

```317:321:apps/desktop/main.js
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
```

After the server is up, the **same** window is pointed at the local UI:

```627:633:apps/desktop/main.js
async function loadAppIntoWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Main window missing when loading app");
  }
  const url = `http://${HOST}:${PORT}/`;
  desktopLog(`loadURL ${url}`);
  await mainWindow.loadURL(url);
}
```

The only related listener logs failures and does not recover or block the URL:

```328:330:apps/desktop/main.js
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    desktopLog(`splash did-fail-load code=${code} desc=${desc} url=${url}`);
  });
```

The loaded React UI contains both in-window and new-window exits from the app origin:

| Location | What it does |
|----------|----------------|
| `apps/server/public/lib/osuUrls.ts` 2–6 | Builds `osu://b/{id}` |
| `PracticeProfilePage.tsx` 285–286 | `<a href={clientUrl}>` (no `target`) — “Open in osu!” |
| `SessionSuggestMapRow.tsx` 102–103 | same `osu://` pattern |
| `PracticeProfilePage.tsx` 117–122 | `https://osu.ppy.sh/…` with `target="_blank"` |
| `OnlineSetCard.tsx` 115–116 | `target="_blank"` “Website” |
| `HubDetailPage.tsx` 149–151 | `https://osu.ppy.sh/beatmapsets/…` `target="_blank"` |
| `HubCollectionCard.tsx` 102–104 | osu! profile, `target="_blank"` |
| `SchemaOutdatedDialog.tsx` 4, 80–84 | `https://github.com/Yon-Luc/Roxysu` `target="_blank"` |
| `ShareScoreLinkButton.tsx` 32–33 | clipboard fallback: `window.open(url, "_blank", "noopener,noreferrer")` |

### What happens and why

1. `createSplashWindow` attaches `preload.js` to the window. `contextIsolation` is on and `nodeIntegration` is off — good — but the preload stays with that `webContents` for its lifetime, including after `loadURL`.
2. The user clicks a `target="_blank"` link (osu! website, GitHub) or the share button’s `window.open` fallback.
3. Electron’s documented default is to open a new `BrowserWindow`. Unless `setWindowOpenHandler` overrides it, that child **inherits the parent’s `webPreferences`, including the preload**.
4. The foreign origin then has `window.roxysuDesktop.openExternal` and `writeClipboardImage` (see M2: those handlers also do not check `event.senderFrame.url`).
5. Separately, an `<a href="osu://b/…">` click fires in-place navigation of the **main** window. There is no protocol handler and no `will-navigate` preventDefault. The load fails (`did-fail-load` only logs), and the user can be left on a blank/error page with no in-app way back short of restarting.

Root cause: the shell treats the window like a browser tab with a trusted origin, but never pins navigation to `http://127.0.0.1:4321/` (or the configured host/port) and never forces external URLs through `shell.openExternal`.

**Not runtime-verified:** inheritance of preload onto a child window under Electron 45.2.1 specifically. The finding is the missing guards plus documented Electron defaults, plus the `osu://` in-place navigation which does not depend on inheritance.

### Impact

- **Security:** a page that is not the local app can obtain the desktop bridge and open arbitrary https URLs (phishing) or write images to the clipboard. Combined with M2 this is the highest-severity issue.
- **User-visible:** “Open in osu!” can blank the main window instead of launching lazer/stable. External “Website” links can open a second Electron chrome instead of the system browser.
- **Performance:** not the main concern; extra windows are a resource leak of a sort, but the security/UX cost dominates.

### How to reproduce or verify

Packaged or `bun run desktop`, after the UI is up (not run in this review):

1. Open a practice profile that has an online beatmap id. Click **Open in osu!**. Expect: osu!/lazer opens, Roxysu stays on the profile. Risk: the Roxysu window navigates to `osu://…` and goes blank.
2. Click a **Website** / GitHub / profile `target="_blank"` link. Expect: system browser. Risk: a second Electron window. In DevTools on that window, check whether `window.roxysuDesktop` is defined (it must not be).
3. Static verification already done: no `setWindowOpenHandler` / `will-navigate` in the tree; the links above exist.

### Proposed fix

Add a small allowlist helper and attach it to every window you create (today there is only one). Deny new windows; send http(s) and `osu:` to the system. Block in-place navigation off the app origin the same way. Also cover `will-redirect`.

```js
const APP_ORIGIN = `http://${HOST}:${PORT}`;

function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function canOpenExternal(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "osu:"
    );
  } catch {
    return false;
  }
}

function openExternalSafe(url) {
  if (!canOpenExternal(url)) return;
  desktopLog(`openExternal (navigation) ${url}`);
  void shell.openExternal(url).catch((err) => {
    desktopLog(`openExternal failed: ${err}`);
  });
}

function attachWindowGuards(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });

  const blockOffApp = (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  };
  win.webContents.on("will-navigate", blockOffApp);
  win.webContents.on("will-redirect", blockOffApp);
}
```

Call `attachWindowGuards(mainWindow)` in `createSplashWindow` immediately after constructing the window (before `loadFile` / later `loadURL`). Keep `did-fail-load` but consider showing the splash error and offering a reload when the failed URL is the app origin (see M5).

Optional UI follow-up (not required if the shell intercepts correctly): “Open in osu!” buttons can `preventDefault` and call `shell.openExternal` via a new preload method, or `window.roxysuDesktop.openExternal` if you extend that API to allow `osu:`.

### Alternatives and trade-offs

- **Open child windows with a stripped `webPreferences` (no preload) instead of denying.** Worse: you still embed untrusted sites in Electron chrome. Deny + system browser is the usual recommendation.
- **Fix only the React links** (`target="_blank"` to `openExternal`, `osu://` click handlers). Incomplete: any future link, markdown, or XSS still navigates unguarded.
- Allowlisting only `127.0.0.1` (not `HOST`) would break a custom `ROXYSU_HOST`. Using `APP_ORIGIN` from the same constants already used for `loadURL` is the right scope.

### How to test the fix

- Unit-test `isAppUrl` / `canOpenExternal` in a small pure module (same pattern as `respawnPolicy.js`): accept `http://127.0.0.1:4321/` and `/#/overlay`; reject `http://evil.example`, `file:///`, and `javascript:`; treat `https://osu.ppy.sh` as external, not as an app URL; accept `osu://b/1` as an external URL.
- Manual: the three click paths above. Confirm a single window remains, `window.roxysuDesktop` exists only on the app origin, and osu!/the browser opens.
- Also click an in-app React route (`/practice`) and confirm in-app navigation still works.

---

## M2 — IPC does not check the sender; `openExternal` accepts any http(s) URL

**Severity:** Medium on its own; High when combined with H1

### Where

Preload exposes two invoke channels to every page that inherits it:

```3:15:apps/desktop/preload.js
contextBridge.exposeInMainWorld("roxysuDesktop", {
  platform: process.platform,
  versions: { electron, chrome, node },
  openExternal: (url) => ipcRenderer.invoke("roxysu:open-external", url),
  writeClipboardImage: (pngBytes) =>
    ipcRenderer.invoke("roxysu:write-clipboard-image", pngBytes),
});
```

Main-process handlers:

```717:749:apps/desktop/main.js
ipcMain.handle("roxysu:open-external", async (_event, url) => {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Invalid URL");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  desktopLog(`openExternal ${parsed.origin}${parsed.pathname}`);
  await shell.openExternal(parsed.toString());
});

ipcMain.handle("roxysu:write-clipboard-image", async (_event, bytes) => {
  // null/empty checks, then Buffer.from(...) with no size cap, then clipboard.writeImage
});
```

The only in-tree caller of `openExternal` is hub OAuth:

```118:127:apps/server/public/features/hub/HubLoginButton.tsx
              const begin = await beginHubOAuthHandoff();
              await open(
                hubLoginUrl(hubUrl, {
                  client: "desktop",
                  nonce: begin.handoff,
                  challenge: begin.challenge,
                }),
              );
```

`writeClipboardImage` is the session-share fallback in `apps/server/public/lib/sessionShareImage.ts` 36–41.

### What happens and why

The scheme check correctly blocks `file:`, `javascript:`, and custom-protocol tricks that historically bit `shell.openExternal`. What is missing:

1. **Sender origin.** `_event` is ignored. Any frame that can call the preload can invoke both handlers. After H1’s unguarded navigation, that includes a child window or a main window that has left localhost.
2. **Destination allowlist.** Any `https://` URL is opened, including look-alike phishing sites. Today the UI only needs the configured Hub origin (and, if you later route website links through this API, osu!/GitHub).
3. **Clipboard bound.** Covered in L1; same handler.

Root cause: the IPC surface was written as a convenience bridge for a trusted renderer, without assuming that renderer might change origin.

### Impact

- **Security:** phishing via `openExternal('https://…')`; clipboard tampering via `writeClipboardImage`. Protocol restriction already prevents the worst `openExternal` cases involving local files or custom schemes.
- **User-visible:** only if something untrusted can call the bridge, or a UI bug passes a bad URL.
- **Performance:** unbounded clipboard payloads can spike main-process memory (L1).

### How to reproduce or verify

Static: handlers ignore `_event`; no allowlist beyond scheme. Confirmed `openExternal` is only used for hub login.

If you have a DevTools console on the app origin (trusted): `await window.roxysuDesktop.openExternal('https://example.com')` will open it — illustrating that any script on a page with the preload can do the same.

### Proposed fix

Share `APP_ORIGIN` / `isAppUrl` with H1. Reject other senders. Optionally restrict destinations; a practical allowlist is “Hub URL plus known website hosts” or “any http(s) *only after* the sender check.”

```js
function senderIsApp(event) {
  const url = event.senderFrame?.url;
  return typeof url === "string" && isAppUrl(url);
}

function isAllowedExternalDestination(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  // Tight option: only the configured Hub (OAuth) plus osu! / GitHub website links.
  // Looser option (sender check is the real control): return true here.
  const allowedHosts = new Set([
    "osu.ppy.sh",
    "www.ppy.sh",
    "github.com",
  ]);
  try {
    const hubHost = new URL(process.env.HUB_URL?.trim() || "https://roxysu-api.yonx.app").host;
    allowedHosts.add(hubHost);
  } catch {
    // ignore bad HUB_URL
  }
  return allowedHosts.has(parsed.host);
}

ipcMain.handle("roxysu:open-external", async (event, url) => {
  if (!senderIsApp(event)) throw new Error("Invalid sender");
  if (typeof url !== "string" || !url.trim()) throw new Error("Invalid URL");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!isAllowedExternalDestination(parsed.toString())) {
    throw new Error("URL is not allowed");
  }
  desktopLog(`openExternal ${parsed.origin}${parsed.pathname}`);
  await shell.openExternal(parsed.toString());
});
```

See L1 for the clipboard half of this handler (sender check + size cap).

### Alternatives and trade-offs

- **Sender check only, keep any http(s) destination.** Simpler, and enough if H1 is fixed so only the local UI can call IPC. A destination allowlist can break a future “open this URL” feature or a self-hosted Hub on an unexpected host — if you go tight, always include `HUB_URL`.
- **Move OAuth to `shell.openExternal` in the main process** after the main process itself creates the handoff, so the renderer never passes a URL. More invasive.
- Do not allow `osu:` on this existing channel unless the UI actually uses it; H1’s navigation hook can open `osu:` without changing the OAuth API.

### How to test the fix

- Unit-test `senderIsApp` / `isAllowedExternalDestination` with sample URLs (hub, osu, `file:`, `javascript:`, other https).
- Manual: Hub login still opens the system browser and completes the handoff.
- Manual (after H1, or with a temporary test page): from a denied origin, invoke should throw and must not open a browser. DevTools on the app origin should still succeed for the hub URL.

---

## M3 — `stopChild` can hang forever; `before-quit` then never finishes

**Severity:** Medium (correctness; can prevent Quit)

### Where

```645:670:apps/desktop/main.js
function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      desktopLog(`${label} ignored SIGTERM for ${CHILD_STOP_GRACE_MS}ms — SIGKILL`);
      try {
        child.kill("SIGKILL");
      } catch (err) {
        desktopLog(`failed to SIGKILL ${label}: ${err}`);
        resolve();
      }
    }, CHILD_STOP_GRACE_MS);
    child.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch (err) {
      desktopLog(`failed to stop ${label}: ${err}`);
      clearTimeout(killTimer);
      resolve();
    }
  });
}
```

Quit is held until this promise (and the other children) resolve:

```908:915:apps/desktop/main.js
  app.on("before-quit", (event) => {
    if (quitAfterShutdown) return;
    event.preventDefault();
    void shutdown().then(() => {
      quitAfterShutdown = true;
      app.quit();
    });
  });
```

`CHILD_STOP_GRACE_MS` is 5000 (line 495). `shutdown()` (692–715) memoizes one `Promise.all` of three `stopChild` calls.

### What happens and why

This is a classic `child_process` race:

1. The function checks `exitCode` / `signalCode` and sees a live child.
2. Before `child.once("exit", …)` is registered, the process exits (or it exited after the check but the events already fired).
3. `child.kill("SIGTERM")` returns `false` and does **not** throw when the pid is already gone.
4. `'exit'` will not fire again, so `resolve()` is never called from that path.
5. Five seconds later SIGKILL runs. The same pattern: `kill("SIGKILL")` returns `false` or succeeds on a process that will not emit `'exit'` again, and `resolve()` is only called in the `catch` block.
6. `shutdown()` never settles. Every later `before-quit` still calls `preventDefault()` because `quitAfterShutdown` stays false.

Root cause: the code treats `kill()` throw as the only “already dead” signal, and the SIGKILL timer does not always resolve.

The race window is narrow, but Quit is a hot path (window close on Windows/Linux calls `app.quit()` from `window-all-closed`). Overlay URL changes also call `stopChild` without awaiting (M7); a hang there would stall a later shutdown `Promise.all` if the same child reference were used. After `overlayChild = null` the shutdown call may already have a different reference, so the damaging case is primarily **app quit**.

**Not verified:** a live stuck-Quit reproduction in Electron.

### Impact

- **User-visible:** File/close or the window X appears to do nothing; the process and possibly children remain. Port 4321 can stay occupied (the failure mode this shutdown path was written to prevent).
- **Security / performance:** not the main issue, other than a wedged process.

### How to reproduce or verify

Code inspection is the primary evidence. A Node-only unit test can drive a fake child:

- `exitCode` already set → resolves immediately.
- emit `'exit'` right after attaching the listener → resolves, timer cleared.
- `kill()` returns `false` → resolves without waiting 5 s.
- `kill("SIGTERM")` succeeds, no `'exit'` until the grace period, then `kill("SIGKILL")` returns `false` → must still resolve (this is the current hole).

### Proposed fix

Use a single idempotent `done()`, treat a falsey `kill()` as success, and re-check exit state after installing the listener. Extracting this to `stopChild.js` (like `respawnPolicy.js`) makes it easy to test without Electron.

```js
function stopChild(child, label) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve();
    };

    const killTimer = setTimeout(() => {
      desktopLog(`${label} ignored SIGTERM for ${CHILD_STOP_GRACE_MS}ms — SIGKILL`);
      try {
        if (!child.kill("SIGKILL")) done();
      } catch (err) {
        desktopLog(`failed to SIGKILL ${label}: ${err}`);
        done();
      }
      if (child.exitCode !== null || child.signalCode !== null) done();
    }, CHILD_STOP_GRACE_MS);

    child.once("exit", done);

    try {
      if (!child.kill("SIGTERM")) done();
    } catch (err) {
      desktopLog(`failed to stop ${label}: ${err}`);
      done();
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) done();
  });
}
```

Also add a `.catch()` on the `shutdown()` promise in `before-quit` so a future throw cannot skip `app.quit()` (pair with M5):

```js
void shutdown()
  .catch((err) => desktopLog(`shutdown failed: ${err}`))
  .finally(() => {
    quitAfterShutdown = true;
    app.quit();
  });
```

### Alternatives and trade-offs

- **Hard timeout around all of `shutdown()` (e.g. 8 s) then `app.exit()`.** Good belt-and-suspenders even after this fix, in case a child is unkillable (D-state). Slight risk of exiting before logs are closed.
- **`child.killed` checks.** The existing comments correctly note that `killed` is not the same as “exited”. Do not use it as the liveness predicate.

### How to test the fix

- Preferred: move `stopChild` (and `CHILD_STOP_GRACE_MS`) into a tiny module; fake a `ChildProcess`-like EventEmitter with `kill()` / `exitCode` / `signalCode`. Cases listed under “reproduce”.
- Manual: quit from the splash (during `waitForServer`) and from the loaded UI; confirm the process exits in well under ~6 s and that `ROXYSU_PORT` is free (`ss -ltn | grep 4321` or equivalent).

---

## M4 — `waitForServer` double-retries, never cancels, and treats any HTTP status below 500 as the app

**Severity:** Medium (startup correctness; can attach to the wrong process)

### Where

```203:236:apps/desktop/main.js
function waitForServer(port, host, timeoutMs = 180_000) {
  const started = Date.now();
  const healthPath = "/api/system/healthz";
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host, port, path: healthPath, timeout: 1500 }, (res) => {
        res.resume();
        if ((res.statusCode ?? 500) < 500) {
          resolve(undefined);
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for Roxysu at http://${host}:${port}${healthPath}`));
        return;
      }
      setTimeout(tryOnce, 250);
    };

    tryOnce();
  });
}
```

The endpoint it hits is intentionally trivial:

```79:80:apps/server/src/routes/system.ts
export const systemRoutes = new Elysia({ prefix: "/system" })
  .get("/healthz", () => ({ ok: true }))
```

The server child logs “running” immediately after calling `listen`, with no error path in `index.node.ts` for a bind failure:

```53:73:apps/server/src/index.node.ts
  app.listen({ port, hostname }, (info) => {
    guardUpgradeSocketErrors(info);
  });
  // … other boot work …
  console.log(`🦊 Roxysu (node) running at http://${hostname}:${port}`);
```

(`EADDRINUSE` handling inside `@elysiajs/node` was not executed in this review.)

### What happens and why

Three independent problems share this function.

**A. Double retry (verified).** A hung TCP accept (port open, no HTTP response) hits the 1.5 s timeout. The handler calls `req.destroy()` and `retry()`. Destroy emits `'error'` (`ECONNRESET`, verified with Node), and that handler also calls `retry()`. Two `setTimeout(tryOnce, 250)` are queued. If those also time out, the number of in-flight probes can grow while the 180 s budget remains. Fast `ECONNREFUSED` (nothing listening yet) only emits `'error'` and does not amplify — so a healthy “wait for listen” path is usually fine. Amplification shows up when something is listening but not answering in 1.5 s (slow boot, foreign service, half-open port).

**B. No settled / abort flag.** After `resolve()` or `reject()`, already-queued timers still call `tryOnce`. `resolve()` twice is a no-op, but a late `'error'` can call `retry()` and keep probing until the 180 s mark. Closing the splash / calling `shutdown()` does not cancel the loop. Combined with M5, a user who quits during the wait can still have `waitForServer` succeed later and then `loadAppIntoWindow()` throw.

**C. Weak identity check.** Success is “HTTP status below 500”. 404 from another local app counts. Body is discarded (`res.resume()`). If a leftover Roxysu (or anything else) already owns port 4321:

- `waitForServer` can succeed immediately, then `loadURL` attaches the window to that other process; and/or
- the newly spawned server fails to bind. If that child exits, the `'exit'` handler (M8) shuts the whole desktop down — including a window that had just found a healthy leftover server.

Root cause: a minimal poll loop that was never given cancellation, deduping, or a unique health contract.

### Impact

- **User-visible:** “app starts then immediately exits” when 4321 is already taken; or the window talks to a stale/wrong server; or startup keeps working after a 3-minute hang with extra HTTP noise.
- **Security:** loading a foreign HTTP service into a window that still has the preload (H1) is the dangerous version of (C).
- **Performance:** timeout-path request amplification on the local port.

### How to reproduce or verify

Double-retry: already verified outside Electron with a TCP server that never responds (`timeout | error ECONNRESET`).

Wrong server (manual, not run here): start any HTTP server on 4321 (for example `python3 -m http.server 4321 --bind 127.0.0.1`), then start the desktop app. `waitForServer` should not treat this as Roxysu.

Port conflict: start `bun run --cwd apps/server dev`, then start the desktop shell on the same port.

### Proposed fix

```js
function waitForServer(port, host, timeoutMs = 180_000, options = {}) {
  const started = Date.now();
  const healthPath = "/api/system/healthz";
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let inFlight = null;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (inFlight) inFlight.destroy();
      if (err) reject(err);
      else resolve(undefined);
    };

    if (signal) {
      if (signal.aborted) {
        finish(new Error("waitForServer aborted"));
        return;
      }
      signal.addEventListener("abort", () => finish(new Error("waitForServer aborted")), {
        once: true,
      });
    }

    const tryOnce = () => {
      if (settled) return;
      const req = http.get({ host, port, path: healthPath, timeout: 1500 }, (res) => {
        const chunks = [];
        let total = 0;
        res.on("data", (chunk) => {
          total += chunk.length;
          if (total > 4096) {
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          if (res.statusCode === 200) {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (body && body.ok === true) {
                finish();
                return;
              }
            } catch {
              // not our healthz
            }
          }
          retry();
        });
      });
      inFlight = req;
      const onFail = () => {
        if (!settled) retry();
      };
      req.on("error", onFail);
      req.on("timeout", () => {
        req.destroy();
        // 'error' will call onFail once; do not retry here
      });
    };

    const retry = () => {
      if (settled) return;
      if (Date.now() - started > timeoutMs) {
        finish(
          new Error(`Timed out waiting for Roxysu at http://${host}:${port}${healthPath}`),
        );
        return;
      }
      timer = setTimeout(tryOnce, 250);
    };

    tryOnce();
  });
}
```

Stronger health contract (recommended): change `/api/system/healthz` to return a unique marker, e.g. `{ ok: true, service: "roxysu" }`, and require it in the poll. Keep `{ ok: true }` accepted during a transition if needed.

Wire an `AbortController` in `whenReady`, aborted from `shutdown()`. If `serverChild` exits during the wait, abort immediately instead of waiting out 180 s (the exit handler already shuts down; fail the wait so M5 can show the error cleanly).

### Alternatives and trade-offs

- **Require a 200 only, still ignore the body.** Cheap but still fooled by any 200 on that path.
- **Pass a random one-shot token via env** (`ROXYSU_BOOT_TOKEN`) and have healthz echo it. Strong identity, slightly more plumbing.
- **Have the server write a ready file under `ROXYSU_DATA_DIR`.** Works even if HTTP is confused; two sources of truth to keep in sync.
- Tightening healthz is a tiny API change and is safe for the browser UI (nothing in-tree depends on the exact body beyond “the server answers”).

### How to test the fix

- Unit-test the poll against a local `http.Server`: 200 `{ ok: true }` resolves; 404 / 200 HTML / 503 retries then rejects; timeout+destroy retries once; `abort()` rejects and destroys the in-flight request; no second request after resolve.
- Manual: the python `http.server` case must show “Failed to start — see logs”, not the Python directory listing inside Electron.
- Manual: normal cold start still reaches “Opening Home” as soon as the real server is up.

---

## M5 — Startup / reload errors are unhandled; a failed `loadURL` leaves the splash up

**Severity:** Medium (correctness / UX)

### Where

The main startup chain is an `async` `whenReady().then` **without** `.catch()`:

```770:770:apps/desktop/main.js
  app.whenReady().then(async () => {
```

`waitForServer` is in try/catch (861–869) and can show “Failed to start — see logs”. The work immediately after is not:

```872:876:apps/desktop/main.js
    desktopLog("waitForServer ok");
    await setSplashStatus("Opening Home");
    await maybeClearHttpCache(paths);
    await loadAppIntoWindow();
    desktopLog("ready");
```

`loadAppIntoWindow` throws if the window is gone, and `loadURL` can fail on its own (627–633).

macOS dock re-open is the same pattern, with no health re-check:

```891:897:apps/desktop/main.js
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void (async () => {
          createSplashWindow(paths);
          await loadAppIntoWindow();
        })();
      }
    });
```

(The only `.catch` in `main.js` is the splash `loadFile` at lines 338–341.)

### What happens and why

1. User closes the splash while `waitForServer` is still running (no abort — M4). The window’s `closed` handler sets `mainWindow = null`. `window-all-closed` calls `app.quit()` (non-Darwin), which runs `shutdown()`.
2. If the server becomes ready, `waitForServer` still resolves. `setSplashStatus` no-ops (destroyed window). `loadAppIntoWindow()` throws `"Main window missing when loading app"`.
3. That rejection is unhandled. Depending on timing, quit may already be in progress (OK-ish) or the process may linger with a logged exception.

Other failure modes: `loadURL` fails (server answered healthz then died, DNS/IPv6 oddity with a custom host, etc.). The splash stays on “Opening Home” forever. `did-fail-load` logs, but nothing updates the status or exits.

On Darwin, closing the window does not quit; later `activate` calls `loadAppIntoWindow()` immediately. If the server has died in the background (and M8 has not already exited the app — it would have), load fails with the same unhandled rejection.

Root cause: incomplete error handling around the only two paths that call `loadURL`.

### Impact

- **User-visible:** stuck splash, or a flash of error after the user already tried to quit; macOS re-open can fail silently.
- **Security / performance:** unhandled rejections are sloppy but not a direct vulnerability.

### How to reproduce or verify

- Static: no `.catch` on `whenReady`, no try/catch around `loadAppIntoWindow`.
- Manual (not run here): quit during the splash wait; confirm no unhandled-rejection dialog and a clean process exit (needs M4 abort as well).
- Manual: after “Waiting for server”, stop the server child or block `loadURL` and confirm the splash shows a failure string instead of hanging on “Opening Home”.

### Proposed fix

```js
  app.whenReady().then(async () => {
    // … existing setup through spawn server …
    try {
      await waitForServer(PORT, HOST, 180_000, { signal: shutdownSignal });
    } catch (err) {
      desktopLog(`waitForServer failed: ${err}`);
      desktopLog(`see logs under ${path.join(paths.dataDir, "logs")}`);
      await setSplashStatus("Failed to start — see logs", { animateDots: false });
      await shutdown();
      app.exit(1);
      return;
    }

    desktopLog("waitForServer ok");
    await setSplashStatus("Opening Home");
    try {
      await maybeClearHttpCache(paths);
      await loadAppIntoWindow();
    } catch (err) {
      desktopLog(`loadAppIntoWindow failed: ${err}`);
      await setSplashStatus("Failed to open Home — see logs", { animateDots: false });
      await shutdown();
      app.exit(1);
      return;
    }
    desktopLog("ready");
    // … realm, overlay, auto-update, activate …
  }).catch(async (err) => {
    desktopLog(`whenReady failed: ${err}`);
    try {
      await shutdown();
    } catch (shutdownErr) {
      desktopLog(`shutdown failed: ${shutdownErr}`);
    }
    app.exit(1);
  });
```

And for `activate`:

```js
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void (async () => {
          try {
            createSplashWindow(paths);
            await setSplashStatus("Opening Home");
            await waitForServer(PORT, HOST, 15_000, { signal: shutdownSignal });
            await loadAppIntoWindow();
          } catch (err) {
            desktopLog(`activate load failed: ${err}`);
            await setSplashStatus("Failed to open Home — see logs", { animateDots: false });
          }
        })();
      }
    });
```

### Alternatives and trade-offs

- **`app.exit` on any load failure vs stay on splash with a retry button.** Exit is consistent with the existing `waitForServer` failure path. A “Retry” on the splash is nicer but needs a small IPC or `executeJavaScript` click target (the splash currently has no scripts; its CSP forbids them).
- A process-level `unhandledRejection` logger is useful for diagnostics but should not be the only fix.

### How to test the fix

- Manual: kill the server after healthz succeeds but before load (or point `ROXYSU_HOST` at a closed port after a delayed start) and confirm a visible failure and a process exit.
- Manual: close the splash during “Waiting for server”; process should exit without an unhandled-rejection dialog (with M4 abort).
- If you add a Darwin build later: close the window, Quit not involved, click the dock icon; a dead server should show the error splash, not a blank rejection.

---

## M6 — First-run realm extract blocks the Electron main process

**Severity:** Medium (performance / first-run UX)

### Where

```125:161:apps/desktop/paths.js
function ensureRealmExtracted(paths) {
  if (!paths.realmArchive) { /* dev / unpacked; may throw if missing */ return; }
  const marker = path.join(paths.realmDir, ".roxysu-extracted");
  if (fs.existsSync(marker) && fs.existsSync(paths.realmEntry)) {
    return;
  }
  fs.mkdirSync(paths.realmDir, { recursive: true });
  execFileSync(
    "tar",
    ["-xzf", paths.realmArchive, "-C", paths.realmDir, "--strip-components=1"],
    { stdio: "inherit" },
  );
  // flatten + marker write, all sync
}
```

The comment on lines 121–122 is explicit: the archive exists so the install tree stays small for Defender (“one file vs ~GB of natives”).

It is invoked on the Electron main thread from `spawnRealmReader`:

```356:360:apps/desktop/main.js
  try {
    ensureRealmExtracted(paths);
  } catch (err) {
    desktopLog(`realm extract failed: ${err}`);
    return "failed";
  }
```

That spawn is intentionally deferred until **after** the UI is up:

```878:880:apps/desktop/main.js
    // Defer Realm until the UI is up; extract archive lazily (shrink AV scan at install).
    if (spawnRealmReader(paths, sharedEnv) === "failed") {
      scheduleRealmRespawn(paths, sharedEnv);
    }
```

Respawn (`scheduleRealmRespawn` → timer → `spawnRealmReader`) can hit the same sync extract again if the marker/entry is missing.

### What happens and why

`execFileSync` plus `existsSync` / `readdirSync` / `renameSync` / `writeFileSync` block the main process until `tar` finishes. Electron cannot paint, handle input, or run other main-process work (IPC, quit) during that time. First packaged Windows launch is the painful case (extract + Defender scanning the unpacked natives). Subsequent launches return early at the marker and are fine.

Root cause: lazy extract was added for install size / AV, but the work was left synchronous on the UI thread.

**Not measured:** actual tarball size or extract duration on a real Windows box.

### Impact

- **User-visible / performance:** the just-opened Home view (or splash, if extract is ever moved earlier) freezes for the length of `tar -xzf`. Can look like a hang.
- **Security:** none directly. A stuck main process also delays Quit (M3) if the user tries to close mid-extract.

### How to reproduce or verify

- Static: `execFileSync` on the path called from `spawnRealmReader` after `loadAppIntoWindow`.
- Manual (packaged Windows, delete `%APPDATA%\Roxysu\runtime\realm-reader` or the `.roxysu-extracted` marker, launch): the window should remain interactive while extract runs. Today it may freeze. Watch `desktop.log` timestamps around `realm extract` / `spawn realm-reader`.

### Proposed fix

Split “already extracted?” (sync, cheap) from “run tar” (async). Keep the marker protocol and flatten logic. In `paths.js`:

```js
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

function realmExtractNeeded(paths) {
  if (!paths.realmArchive) {
    if (!fs.existsSync(paths.realmEntry) && !fs.existsSync(paths.realmDir)) {
      throw new Error(`realm-reader missing at ${paths.realmDir}`);
    }
    return false;
  }
  const marker = path.join(paths.realmDir, ".roxysu-extracted");
  return !(fs.existsSync(marker) && fs.existsSync(paths.realmEntry));
}

async function ensureRealmExtracted(paths) {
  if (!realmExtractNeeded(paths)) return;
  fs.mkdirSync(paths.realmDir, { recursive: true });
  await execFileAsync(
    "tar",
    ["-xzf", paths.realmArchive, "-C", paths.realmDir, "--strip-components=1"],
    { windowsHide: true },
  );
  const nested = path.join(paths.realmDir, "realm-reader", "index.js");
  if (!fs.existsSync(paths.realmEntry) && fs.existsSync(nested)) {
    const nestedDir = path.join(paths.realmDir, "realm-reader");
    for (const name of fs.readdirSync(nestedDir)) {
      fs.renameSync(path.join(nestedDir, name), path.join(paths.realmDir, name));
    }
    fs.rmSync(nestedDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(paths.realmEntry)) {
    throw new Error(
      `realm extract did not produce ${paths.realmEntry} from ${paths.realmArchive}`,
    );
  }
  fs.writeFileSync(path.join(paths.realmDir, ".roxysu-extracted"), new Date().toISOString(), "utf8");
}

module.exports = {
  resolveDesktopPaths,
  ensureParentDir,
  ensureRealmExtracted,
  realmExtractNeeded,
};
```

In `spawnRealmReader`, make the function `async` (or add `spawnRealmReaderAsync`) and `await ensureRealmExtracted(paths)` after updating the splash/status (“Preparing library sync…”). The initial call site and the respawn timer become `void spawnRealmReader(…).then(result => { if (result === "failed") scheduleRealmRespawn(…); })`. Guard with `shuttingDown` after the await so a quit mid-extract does not spawn.

If `tar` is still running at Quit, `shutdown()` should abort or ignore it; the marker is only written on success, so a retry is safe (current `"failed"` → reschedule already covers a thrown extract).

### Alternatives and trade-offs

- **Extract during the splash, before `loadURL`, but async with a status line.** Slightly slower first “Home”, but no post-load freeze; maybe clearer UX.
- **Worker thread / detached `tar` process.** Same as `execFile` for this purpose; `execFile` is enough.
- **Unpack at install time** (NSIS). Restores the large-tree Defender cost the tarball was designed to avoid.

Keep flatten + marker semantics; do not loop tightly on extract failure (existing backoff already handles that).

### How to test the fix

- Unit: fake `fs` + fake `execFile` — marker+entry present means no exec; missing marker means exec then marker written; `tar` fail throws, no marker; nested `realm-reader/index.js` flatten path works.
- Manual: delete the extract dir, launch packaged app, confirm the window stays responsive and realm-reader starts after extract (log lines). Second launch should not run `tar`.

---

## M7 — Overlay `apply()` is not serialized and does not await `stopChild`

**Severity:** Medium (correctness on Linux/Wayland; process leak)

### Where

```502:530:apps/desktop/main.js
function fetchOverlaySettings() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: HOST, port: PORT, path: "/api/settings", timeout: 2000 },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          // JSON.parse, no status check, no size cap
        });
      },
    );
    // error / timeout → null
  });
}
```

```550:601:apps/desktop/main.js
  const apply = async () => {
    if (shuttingDown) return;
    const settings = await fetchOverlaySettings();
    if (shuttingDown) return;
    const decision = decideOverlayApply({ /* … */ });
    // …
    if (decision.action === "spawn") {
      if (decision.stopRunning) stopChild(overlayChild, "overlay"); // not awaited
      overlayChild = null;
      spawnOverlayHost(paths, decision.urlArg);
    }
  };

  void apply();
  overlayPollTimer = setInterval(() => void apply(), OVERLAY_SETTINGS_POLL_MS);
```

`OVERLAY_SETTINGS_POLL_MS` is 4000 (line 492). The HTTP timeout is socket inactivity (2 s), not a hard deadline for the whole body. `apply()` has no try/catch. `watchOverlayHostSetting` only runs on Linux with `WAYLAND_DISPLAY` and a resolved overlay binary (541–543).

### What happens and why

The happy path does not overlap: a 2 s timeout and a 4 s interval usually mean one `apply()` at a time. Overlap appears when `/api/settings` is slow to finish (large or trickle body; the inactivity timeout resets as chunks arrive; there is no byte cap). Then:

1. `apply` #1 is awaiting `fetchOverlaySettings`.
2. The interval starts `apply` #2, which also fetches and also sees `overlayChild === null` (or the same live child).
3. Both decide `spawn`. Each may `stopChild` (not awaited) and call `spawnOverlayHost`.
4. `overlayChild` holds only the last process. The earlier host keeps drawing and is **not** stopped in `shutdown()` (708–710 only signal the current pointers).

URL changes have a milder version of the same bug: `stopChild` is fired and the new host is spawned immediately, so two HUDs can stack for up to the 5 s grace period. That is probably acceptable visually; the leak under concurrency is not.

`apply()` throwing (e.g. `openChildLogFd` / `writeSync` failing) becomes an unhandled rejection and can skip later bookkeeping.

Root cause: an async poll without an in-flight lock, plus fire-and-forget process replacement.

**Not verified on a live Wayland session.**

### Impact

- **User-visible:** duplicate overlay surfaces over osu!; hosts that survive Quit and keep a layer-shell window.
- **Performance:** extra WebKit processes, leaked fds if something else regresses log reuse.
- **Security:** none directly. Settings body growth is a main-process memory concern.

### How to reproduce or verify

- Code: no mutex, `stopChild` not awaited, unbounded `raw += chunk`, no `res.statusCode` check.
- Manual (Linux + Wayland, not run here): delay `/api/settings` (proxy that sleeps 5 s, or a huge body) and watch for two overlay PIDs (`pgrep -a roxysu-overlay`). Change the HUD URL in Settings and confirm only one host remains after a few seconds. Quit and confirm no leftover overlay process.

### Proposed fix

```js
  let applying = false;

  const apply = async () => {
    if (shuttingDown || applying) return;
    applying = true;
    try {
      const settings = await fetchOverlaySettings();
      if (shuttingDown) return;
      const decision = decideOverlayApply({ /* unchanged */ });
      consecutiveFailures = decision.consecutiveFailures;
      lastKnownEnabled = decision.lastKnownEnabled;

      if (decision.action === "stop") {
        desktopLog(/* unchanged */);
        await stopChild(overlayChild, "overlay");
        overlayChild = null;
        overlayAppliedUrlArg = null;
        return;
      }
      if (decision.action === "spawn") {
        // existing logs…
        if (decision.stopRunning) {
          await stopChild(overlayChild, "overlay");
        }
        overlayChild = null;
        if (!shuttingDown) spawnOverlayHost(paths, decision.urlArg);
      }
    } catch (err) {
      desktopLog(`overlay apply failed: ${err}`);
    } finally {
      applying = false;
    }
  };
```

Tighten `fetchOverlaySettings`: require status 200, cap the body (e.g. 1 MB), destroy the request if the cap is exceeded, and use a hard abort timer (2 s) in addition to the socket timeout. Ignore `enabled` / `hostUrl` unless types match. Re-validate `hostUrl` (L7) before passing `urlArg` into `spawnOverlayHost`.

### Alternatives and trade-offs

- **Queue the latest poll instead of skipping.** Slightly fresher URL updates if a fetch runs long; more code. Skip-if-busy is enough at a 4 s interval.
- **Watch settings via SSE** instead of polling. Fits the app’s event model but is a larger change; the no-IPC-between-processes decision would still allow HTTP SSE.
- Do not cap overlay respawns to “fix” leaks (the HUD should come back; the mutex is the fix).

### How to test the fix

- Policy tests already cover `decideOverlayApply`. Add a test around a thin wrapper if you extract “in-flight + stop then spawn” sequencing with fake `stopChild` / `spawn` functions: overlapping `apply()` only spawns once; `stopChild` is awaited before spawn.
- Manual: delayed `/api/settings` and URL change, as above; Quit leaves no overlay process.

---

## M8 — A server child exit tears down the whole desktop app, with no respawn

**Severity:** Medium (reliability; current documented policy)

### Where

```846:855:apps/desktop/main.js
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

Realm-reader, by contrast, uses `decideRespawn` and can recover. The in-tree desktop knowledge note already describes this as a product consequence: a server that dies on a single bad connection takes the whole desktop app with it. An upgrade-socket guard was added on the server specifically because that was happening.

### What happens and why

This is intentional, not an accidental missing `if`. One policy is “the UI is the server; if the server is gone, the shell is done.” The downside is that any unhandled server crash (an upgrade-socket error that slips past the guard, OOM, native addon abort) closes the user’s window with no in-app recovery. There is no splash “Reconnecting…”, no backoff, and no preservation of the BrowserWindow.

Root cause: process model — one irreversible coupling from `serverChild` exit to `app.exit`.

### Impact

- **User-visible:** the app vanishes mid-session; they must relaunch. In-flight UI state is lost (mostly refetchable). If the crash loop is fast, this is very painful.
- **Performance / security:** N/A, except that a respawn policy must not fork unbounded server processes (reuse the realm-reader backoff ideas).

### How to reproduce or verify

- Static: the exit handler always shuts down when not already quitting.
- Manual: with the desktop app up, `kill` the server child PID (from `desktop.log` / `server.log`). The app should currently exit entirely.

### Proposed fix

If you keep the current policy, at least show a last splash frame (“Server stopped — see logs”) before `app.exit`, and do not treat this as a silent disappearance. That is a small UX patch only.

If you want resilience, mirror the realm-reader pattern with a stricter cap (the UI is unusable without the server, so respawn is appropriate):

```js
    serverChild.on("exit", (code, signal) => {
      if (shuttingDown) return;
      desktopLog(`server exited code=${code} signal=${signal}`);
      scheduleServerRespawn(paths, sharedEnv);
    });
```

`scheduleServerRespawn` would:

1. `setSplashStatus` or a full-window overlay: “Reconnecting to server…” (reload splash if the current page is dead).
2. Use `decideRespawn` (or a dedicated policy: fewer attempts, e.g. 3, with a 2 s base delay).
3. Re-`spawnNodeEntry` for the server, `waitForServer` with a short timeout, then `loadAppIntoWindow()` (clear cache is not needed).
4. Give up → visible failure + `shutdown()` + `app.exit(1)`.

Guard `serverChild` identity like realm-reader (`if (child !== serverChild) return`) so a replaced process does not trigger a second respawn. Abort in-flight waits on shutdown (M4/M5).

### Alternatives and trade-offs

- **Keep exit-is-fatal.** Simplest, and it avoids two servers on one port. Then M4’s bind/health identity work is even more important, and the splash error is the only kindness to add.
- **Respawn the server but not the window** (leave the renderer on a failed HTTP page, then `loadURL` again). Fine if you already have M5 error handling.
- Do not invent an infinite server restart loop — a dying server on a bad DB should give up, as realm-reader does.

### How to test the fix

- Manual: `kill` the server child. Under a respawn policy, Home returns within a few seconds and only one process owns port 4321. Under a fatal policy, the splash should explain the exit, then the process should end.
- A policy unit test can reuse `decideRespawn` if you share it; otherwise test the give-up cap with a fake spawn.

---

## L1 — `writeClipboardImage` has no size limit

**Severity:** Low (main-process memory / IPC hardening)

### Where

```734:749:apps/desktop/main.js
ipcMain.handle("roxysu:write-clipboard-image", async (_event, bytes) => {
  if (bytes == null) throw new Error("Invalid image");
  const buf = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes));
  if (buf.length === 0) throw new Error("Invalid image");
  const image = nativeImage.createFromBuffer(buf);
  if (image.isEmpty()) throw new Error("Invalid image");
  clipboard.writeImage(image);
  desktopLog(`writeClipboardImage bytes=${buf.length}`);
});
```

Caller: `sessionShareImage.ts` 36–41 copies a PNG `Uint8Array` from a session card capture (bounded in the UI to a card with at most 20 highlight rows, but the main process does not know that).

### What happens and why

IPC will deserialize whatever payload the sender provides into a `Buffer` in the main process, then into a `nativeImage`. There is no max length and no sender check (M2). A bug or a compromised renderer can allocate hundreds of MB and block the main thread during image decode.

### Impact

- **Performance:** main-process memory spike / hitch.
- **Security:** only meaningful if untrusted code can call the preload (H1).
- **User-visible:** a stuck UI or a failed share if the image is corrupt (`isEmpty` already throws).

### How to reproduce or verify

Static: no `buf.length` maximum. In DevTools: `window.roxysuDesktop.writeClipboardImage(new Uint8Array(50_000_000))` — should be rejected after the fix; today it will try to decode.

### Proposed fix

Land with M2’s `senderIsApp` check:

```js
const MAX_CLIPBOARD_IMAGE_BYTES = 15 * 1024 * 1024;

ipcMain.handle("roxysu:write-clipboard-image", async (event, bytes) => {
  if (!senderIsApp(event)) throw new Error("Invalid sender");
  if (bytes == null) throw new Error("Invalid image");
  const buf = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes));
  if (buf.length === 0 || buf.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error("Invalid image");
  }
  const image = nativeImage.createFromBuffer(buf);
  if (image.isEmpty()) throw new Error("Invalid image");
  clipboard.writeImage(image);
  desktopLog(`writeClipboardImage bytes=${buf.length}`);
});
```

15 MB is well above a 20-row share card and well below “allocate the world.” Adjust if you ever ship full-resolution replay stills this way.

### Alternatives and trade-offs

- Write to a temp file from the renderer and pass a path — worse (filesystem IPC).
- Do the clipboard write in the renderer only (`ClipboardItem`). The desktop path exists because that fails in some shells; keep the IPC, just cap it.

### How to test the fix

- Manual: Copy-as-image on a large session still succeeds.
- Manual / test: a 20 MB buffer is rejected and the clipboard is unchanged. A call from a non-app origin is rejected (with H1/M2).

---

## L2 — No Content-Security-Policy on the real UI

**Severity:** Low (defense in depth; Medium if you treat XSS on the local UI as in scope)

### Where

The splash, which is only shown before `loadURL`, has a CSP:

```5:8:apps/desktop/splash.html
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'"
    />
```

The packaged UI template does not, and a search of `apps/server` finds no `Content-Security-Policy` header or `helmet` usage.

```1:45:apps/server/public/index.html
<!-- no CSP meta -->
<script>
  try {
    // theme + overlay-mode inline script
  } catch (e) {}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:…&family=Outfit:…&display=swap" rel="stylesheet">
…
<script type="module" src="./index.tsx"></script>
```

After `loadURL`, the privileged preload shares this document origin (`http://127.0.0.1:4321`).

### What happens and why

A CSP was applied where it was easy (static splash) and not where the actual app runs. The real page uses an **inline** script (theme / overlay background), module scripts, `/api/*` fetch/SSE, and Google Fonts. Without a CSP, any XSS (unsafe HTML from a beatmap title, a future markdown surface, etc.) can run script in the same origin as `window.roxysuDesktop`.

This review did not hunt for XSS in the React app. The issue is the missing control, not a demonstrated injection.

### Impact

- **Security:** defense in depth for the preload origin. Lower urgency if H1/M2 are fixed, because a purely local XSS is already a same-origin problem for the HTTP API itself.
- **User-visible:** none until a policy is added incorrectly (broken fonts, broken API, blocked overlay).

### How to reproduce or verify

View-source or DevTools on the loaded app: no CSP in the document or response headers. Contrast with the splash.

### Proposed fix

Prefer a **server header** on HTML (and only HTML) so it cannot be missed after the UI build, and so you can use a nonce for the inline theme script instead of `'unsafe-inline'` for all scripts.

Example policy to iterate on (do not ship untested):

```
default-src 'self';
script-src 'self' 'nonce-{random}';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob: https://assets.ppy.sh;
media-src 'self' blob:;
connect-src 'self' https://fonts.googleapis.com https://roxysu-api.yonx.app;
object-src 'none';
base-uri 'self';
frame-ancestors 'none';
```

You will need to extend `connect-src` for any configured `HUB_URL`, and `img-src` / `media-src` for whatever cover/audio URLs the UI already uses (`osuBeatmapCoverUrl`, local `/api/covers`, `/api/audio`). The overlay route (`/#/overlay`) is the same `index.html` — keep the policy compatible with a transparent HUD (no extra remote script).

Replace the inline script with a nonce or move theme detection into an external `theme-boot.js`.

### Alternatives and trade-offs

- **Meta tag in `index.html` only.** Easier, but a nonce is awkward in a static file; you would likely need `'unsafe-inline'` for the boot script, which weakens XSS protection for scripts.
- **Do nothing until an XSS is found.** Acceptable only after H1/M2, and it leaves the window unusual among Electron apps.
- Tightening fonts to self-hosted Figtree/Outfit removes the Google origins from the policy and is a nicer long-term option (also helps offline).

### How to test the fix

- Load Home, Practice, Sessions, Settings, Hub login, and `/#/overlay` (even in a browser tab). Confirm fonts, covers, audio, SSE, and Hub calls still work.
- DevTools console should report no CSP violations on a clean session.
- A deliberate inline handler or injected script without the nonce should be blocked.

---

## L3 — `webPreferences.sandbox` is not enabled

**Severity:** Low (Electron hardening)

### Where

```317:321:apps/desktop/main.js
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
```

No `sandbox: true` (and no `webSecurity: false` or `nodeIntegrationInWorker` either — those defaults are already safe).

### What happens and why

`contextIsolation` + no `nodeIntegration` is the important pair and is already correct. `sandbox` is the next documented hardening step: the renderer runs in Chromium’s sandbox and the preload is limited to a smaller API surface. It is off by default in Electron. The preload only uses `contextBridge` and `ipcRenderer`, which are compatible with a sandboxed renderer.

### Impact

- **Security:** defense in depth if a renderer exploit is found. Not a stand-alone vulnerability.
- **User-visible:** none if the preload stays this thin. If some hidden Electron API is used later, sandbox can break it — that is the trade-off to test.

### How to reproduce or verify

Static: `sandbox` is absent. After the change, `bun run desktop` should load Home, Hub login (`openExternal`), and session share (`writeClipboardImage`).

### Proposed fix

```js
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
```

### Alternatives and trade-offs

If a future preload needs filesystem or other Node APIs, it would have to go back through IPC anyway — keep the preload thin and leave sandbox on. There is little reason to turn it off for this shell.

### How to test the fix

- Smoke: app boots, splash → Home, DevTools shows `window.roxysuDesktop` on the app origin and not on a denied child window (H1).
- Exercise both IPC methods.

---

## L4 — Desktop and child logs grow without rotation

**Severity:** Low (disk / main-thread I/O)

### Where

```69:81:apps/desktop/main.js
function desktopLog(message) {
  const line = `${new Date().toISOString()} (+${Date.now() - processStartedAt}ms) ${message}\n`;
  try {
    if (!desktopLogPath) {
      const logDir = path.join(earlyDataDir(), "logs");
      fs.mkdirSync(logDir, { recursive: true });
      desktopLogPath = path.join(logDir, "desktop.log");
    }
    fs.appendFileSync(desktopLogPath, line);
  } catch {
    // ignore — logging must never block startup
  }
  console.log(`[roxysu-desktop] ${message}`);
}
```

Child logs (`server.log`, `realm-reader.log`, `overlay.log`) are opened once in append mode and reused (104–114) — good for fd leaks — but never truncated or rotated. `closeChildLogs` only runs at shutdown.

`desktopLog` is called frequently (spawn, overlay polls’ decision logs, auto-update progress, IPC).

### What happens and why

Long-lived sessions and noisy children (especially a crash-looping overlay writing to `overlay.log`) append forever under the userData `logs` directory. `appendFileSync` on every desktop line also does a small sync I/O on the main thread (usually cheap; less cheap if the file is huge or the disk is sleepy).

### Impact

- **Performance / disk:** unbounded growth in `%APPDATA%\Roxysu\logs` (or `~/.config/Roxysu/logs`).
- **User-visible:** only after a long time, or when a user is asked to attach logs and the files are enormous.

### How to reproduce or verify

Inspect `logs/` after a long run. Code: no size check, no date stamp in the filename.

### Proposed fix

A simple size cap is enough and stays in style (sync, best-effort, never throw):

```js
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function appendLogLine(filePath, line) {
  try {
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      // new file
    }
    if (size > MAX_LOG_BYTES) {
      try {
        fs.renameSync(filePath, `${filePath}.1`);
      } catch {
        // ignore
      }
    }
    fs.appendFileSync(filePath, line);
  } catch {
    // ignore
  }
}
```

Use this in `desktopLog`. For child logs, either periodically `stat` and rotate (re-open the fd, update the map) or document that users can delete `*.log`. Re-opening on rotate must not race `stdio` of a live child: rotate only at spawn (`openChildLogFd` already writes a separator — a natural place to check size and open a fresh fd, closing the previous one).

### Alternatives and trade-offs

- **`electron-log` or `winston`.** Heavier than this shell needs.
- **One file per launch** (`desktop-2026-11-17T091800Z.log`) plus a retain-N policy. Nicer for support, a bit more code.
- Leave as-is if you already tell users to wipe `logs/` — still a footgun for long-running overlay hosts.

### How to test the fix

- Unit-test a helper with a tiny `MAX_LOG_BYTES` and a temp dir: write past the cap, assert `file` + `file.1` exist and the active file is small.
- Manual: start the app twice, confirm a separator and no leftover open fds (`lsof`) after a child respawn (regression for the earlier fd-reuse fix).

---

## L5 — `Menu.setApplicationMenu(null)` drops macOS standard roles

**Severity:** Low (platform UX; macOS is not a stated shipping target)

### Where

```792:792:apps/desktop/main.js
    Menu.setApplicationMenu(null);
```

The same file already has a Darwin `activate` handler (891–897) and Darwin path logic in `earlyDataDir`. `package.json` describes the product as a “Windows product path; NixOS/Linux for smoke-testing.”

### What happens and why

Clearing the application menu is a reasonable way to hide the menu bar on Windows/Linux. On macOS, many standard shortcuts and items (`Cmd+Q` Quit, Hide, the Edit menu roles for Copy/Paste/Select All, etc.) come from that menu. Electron apps that set the menu to `null` often lose some of those roles. Chromium may still handle copy/paste inside inputs; `Cmd+Q` / Hide are the usual casualties.

**Not runtime-verified on macOS.** Documented Electron behavior plus the unconditional `null` menu.

### Impact

- **User-visible only on macOS:** awkward quit/hide/edit behavior if someone runs the shell there.
- **Windows/Linux:** no issue (and you likely want no menu bar).

### How to reproduce or verify

On a Mac build: `Cmd+Q`, `Cmd+H`, `Cmd+C` / `Cmd+V` in a Settings text field. Compare with a stub that uses `Menu.buildFromTemplate` with `role: "appMenu"` and `role: "editMenu"`.

### Proposed fix

Only clear the menu on non-Darwin, or install a minimal macOS template:

```js
    if (process.platform === "darwin") {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          { role: "windowMenu" },
        ]),
      );
    } else {
      Menu.setApplicationMenu(null);
    }
```

### Alternatives and trade-offs

- Do nothing until you ship macOS. That is reasonable given the package description. The `activate` path means someone already considered Darwin, so a three-role menu is a cheap insurance policy.
- A custom File menu with an explicit Quit on Windows is optional and not required.

### How to test the fix

- Windows/Linux: still no visible menu bar.
- macOS: Quit / Hide / copy-paste work; no extra “Electron” default menu clutter beyond the standard roles.

---

## L6 — Windows launcher drops command-line arguments

**Severity:** Low (Windows packaging / future deep links)

### Where

The headless Win32 bootstrap starts `RoxysuApp.exe` with a command line that is only the quoted executable — `cmdLine` from `wWinMain` is discarded:

```44:49:apps/desktop/launcher/win/roxysu_launcher.c
  _snwprintf_s(cmd, MAX_PATH * 2, _TRUNCATE, L"\"%s\"", appPath);
  …
  if (!CreateProcessW(appPath, cmd, NULL, NULL, FALSE, 0, NULL, dir, &si, &gChild)) {
```

```56:60:apps/desktop/launcher/win/roxysu_launcher.c
int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrev, PWSTR cmdLine, int nShow) {
  (void)hInstance;
  (void)hPrev;
  (void)cmdLine;
  (void)nShow;
```

`after-pack.mjs` renames the Electron binary to `RoxysuApp.exe` and installs this launcher as `Roxysu.exe` (the name NSIS / portable ExecWait on).

### What happens and why

Users and installers invoke `Roxysu.exe`. Any arguments (deep links, `--inspect`, future protocol associations, flags electron-updater or the user might pass) never reach Electron. The launcher’s job — stay alive until `RoxysuApp.exe` exits so portable NSIS does not delete the unpack directory — is otherwise correct.

This review did not find a current feature that already depends on argv through `Roxysu.exe`. The gap matters when you add one, or when someone starts the app with extra flags and they silently disappear.

**Not verified on a Windows install.**

### Impact

- **User-visible:** only if something tries to pass arguments into `Roxysu.exe`.
- **Security:** forwarding argv is fine if you do not also introduce a string-injection bug in `CreateProcessW`. Use a carefully built command line (quoted exe + original `cmdLine`).

### How to reproduce or verify

On a packed Windows build: `Roxysu.exe --version` or a dummy arg, and log `process.argv` from `main.js`. Today it will not include that arg.

### Proposed fix

Forward the rest of the command line. `cmdLine` from `wWinMain` is the argument tail (not including the exe). Build `cmd = "\"path\\RoxysuApp.exe\" " + cmdLine` with a length check:

```c
  if (cmdLine && cmdLine[0]) {
    _snwprintf_s(cmd, MAX_PATH * 2, _TRUNCATE, L"\"%s\" %s", appPath, cmdLine);
  } else {
    _snwprintf_s(cmd, MAX_PATH * 2, _TRUNCATE, L"\"%s\"", appPath);
  }
```

Keep `CreateProcessW(appPath, cmd, …)` (explicit application name + command line). Rebuild with `build-win-launcher` and pack. Do not pass a writable string that is only `appPath` without quotes when the path can contain spaces — the current quoting of `appPath` must stay.

### Alternatives and trade-offs

- Launch Electron directly as `Roxysu.exe` (no bootstrap). Breaks portable NSIS ExecWait, which is why the launcher exists. Do not remove it.
- Use `ShellExecuteEx` — unnecessary and worse for waiting on the child.

### How to test the fix

- Rebuild the launcher, pack a dir build, run `Roxysu.exe --foo bar` and confirm `process.argv` in `desktop.log`.
- Run with no args (normal install/portable) and confirm the app still starts and the launcher waits until Electron exits.
- Path-with-spaces install directory (Program Files) must still launch.

---

## L7 — Overlay `hostUrl` is not re-validated in the shell

**Severity:** Low (hardening for a privileged on-screen WebKit surface)

### Where

Server PATCH validation is a prefix check, not a real URL parse and not an origin allowlist:

```424:437:apps/server/src/routes/settings.ts
      if (body.overlayHostUrl !== undefined) {
        const trimmed = body.overlayHostUrl?.trim() ?? "";
        if (!trimmed) {
          await db.delete(settings).where(eq(settings.key, OVERLAY_HOST_URL_KEY));
        } else if (
          trimmed.startsWith("http://") ||
          trimmed.startsWith("https://")
        ) {
          await upsertSetting(db, OVERLAY_HOST_URL_KEY, trimmed);
        } else {
          set.status = 400;
          return { error: "overlayHostUrl must be an http(s) URL" };
        }
```

The desktop shell trusts whatever `/api/settings` returned:

```514:518:apps/desktop/main.js
            const hostUrl =
              typeof overlay.hostUrl === "string" && overlay.hostUrl.trim()
                ? overlay.hostUrl.trim()
                : null;
            resolve({ enabled: overlay.enabled !== false, hostUrl });
```

`overlayApplyPolicy.js` then builds `--url=${hostUrl}` (line 86). `spawnOverlayHost` (457–479) passes that single token to the overlay binary with `shell: false` (so extra spaces are not extra argv). There is no check that the URL is localhost / the current `HOST:PORT`.

The Settings UI (`OverlayHostSection.tsx`) is a free-text “HUD URL” field; custom URLs are somewhat intentional. The default is `http://127.0.0.1:4321/#/overlay?bg=clear`.

### What happens and why

A stored or typed `https://evil.example/hud` is accepted by PATCH (`startsWith("https://")`) and loaded in the in-game overlay (a full-screen, often input-transparent WebKit layer over osu!). The shell never re-parses the URL. `startsWith` also allows oddities that are technically http(s) but surprising.

This is partly a feature (custom HUD URL). The gap is that a local XSS or a hand-edited DB can point a privileged overlay at a remote page, and the shell does not enforce the obvious default policy (“only our app origin, plus maybe an explicit user opt-in”).

`shell: false` and a single argv token already prevent classic argument injection via spaces.

### Impact

- **Security:** a remote HUD in a layer-shell window is a serious phishing/click-jacking surface *if* an attacker can change the setting. Normal users typing a URL is a lower bar (they can already open a browser).
- **User-visible:** a typo can point the overlay at the wrong place with no shell-side error, only a failed or unexpected HUD.

### How to reproduce or verify

- Static: prefix check vs `new URL`; no desktop allowlist.
- Manual: set the HUD URL to `https://example.com`, confirm the overlay loads it (expected today). After a tight allowlist, this should be rejected or ignored with a log line, unless you keep an “advanced” escape hatch.

### Proposed fix

In the shell, parse and allow only the app origin (same helper as H1). Optionally allow a documented extra origin later.

```js
function overlayUrlArg(hostUrl, defaultUrlArg) {
  if (hostUrl == null) return defaultUrlArg;
  let parsed;
  try {
    parsed = new URL(hostUrl);
  } catch {
    return null;
  }
  if (parsed.origin !== APP_ORIGIN) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `--url=${parsed.toString()}`;
}
```

Use this in `fetchOverlaySettings` or when applying the decision: if `overlayUrlArg` returns `null`, log `overlay hostUrl rejected` and fall back to the default (or treat as a failed poll — default is friendlier). Tighten PATCH in `settings.ts` the same way (`new URL`, origin must be this server’s public origin) so the UI gets a 400 instead of a silent overwrite.

### Alternatives and trade-offs

- **Keep arbitrary http(s) URLs as a feature** and only reject non-http(s) more strictly (`new URL`, no credentials, no `file:`). Document the risk. This matches the current Settings copy (“URL loaded by the desktop app's in-game overlay host”).
- **Allowlist localhost only** (`127.0.0.1`, `::1`, `localhost`) rather than `APP_ORIGIN`, so a custom port still works if it is local. Slightly looser than “exactly this server.”
- Do not block users who host a custom HUD on another local port — if that is a real workflow, require `127.0.0.1` / `localhost` and http(s), not a remote host.

### How to test the fix

- Extend `overlayApplyPolicy` tests or a new pure helper test: default URL accepted; `http://127.0.0.1:4321/#/overlay?profile=Classic` accepted; `https://evil.example` rejected; `not-a-url` rejected; `javascript:…` rejected.
- Manual: default HUD still appears; saving a same-origin profile URL still restarts the host; a remote URL is rejected in Settings with an error.

---

## Appendix — suggested shared helpers

Several fixes want the same constants. A natural home is a new `apps/desktop/urlPolicy.js` (pure, unit-tested, same style as `respawnPolicy.js` and `overlayApplyPolicy.js`):

- `appOrigin(host, port)`
- `isAppUrl(url, origin)`
- `canOpenExternal(url)` — http(s) + `osu:`
- `overlayUrlArg(hostUrl, origin, defaultUrlArg)`
- `isAllowedExternalDestination(url, { hubUrl, extraHosts })` if you choose a tight M2 allowlist

`main.js` stays responsible for Electron APIs (`setWindowOpenHandler`, `ipcMain.handle`, `shell.openExternal`).

---

## End

All issues above were re-checked against `/workspace/Roxysu` at `bc3eb6be1eba43cd6c146e6da42924bc1f4f83e7`. This file is a review artifact only; the clone was not modified and nothing was pushed.
