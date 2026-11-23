const { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell, clipboard, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const { resolveDesktopPaths, ensureParentDir, ensureRealmExtracted } = require("./paths");
const { startAutoUpdate } = require("./auto-update");
const { DEFAULT_RESPAWN_CONFIG, classifyServerExit, decideRespawn } = require("./respawnPolicy");
const {
  SERVER_STATE_CHANNEL,
  decideRendererGone,
  reloadActionFor,
  serverStateForRespawn,
} = require("./windowRecovery");
const {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  clampZoomLevel,
  sanitizeWindowState,
  serializeWindowState,
} = require("./windowState");
const { ZOOM_STEP, shortcutFor } = require("./shellShortcuts");
const {
  OVERLAY_MAX_RESPAWNS,
  childIsAlive,
  decideOverlayApply,
  overlaySettingsPollMs,
} = require("./overlayApplyPolicy");
const { createApplyGate, executeOverlayDecision } = require("./overlayApplyLoop");
const {
  MAX_OVERLAY_SETTINGS_BYTES,
  parseOverlayHostConfigResponse,
  readCappedBody,
} = require("./overlaySettings");
const { parseOverlayHostUrl, parseOverlayOutput } = require("./overlayUrlGuard");
const { appOrigin, isAppUrl, canOpenExternal, senderIsApp, redactUrlForLog } = require("./urlPolicy");
const { splashLang, splashStatus } = require("./splashLocale");
const { toImageBuffer } = require("./clipboardImage");
const { stopChild: stopChildProcess } = require("./stopChild");
const { probePortOwner, waitForServer } = require("./waitForServer");
const { createOnceGuard } = require("./startupOnce");
const { FATAL_LOG_TAIL_BYTES, buildFatalReport } = require("./fatalReport");
const {
  DEFAULT_MAX_LOG_BYTES,
  copyTruncateIfLarger,
  fileSizeOrZero,
  rotateIfLarger,
  shouldRotate,
} = require("./logRotation");

// Stable userData folder: %APPDATA%\Roxysu (Windows) / XDG or Application Support.
app.setName("Roxysu");

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import("node:child_process").ChildProcess | null} */
let serverChild = null;
/** @type {import("node:child_process").ChildProcess | null} */
let realmChild = null;
/** Timestamp of the last realm-reader spawn (stable-uptime check). */
let realmSpawnedAt = 0;
/** Consecutive short-lived realm-reader runs (respawnPolicy input). */
let realmRespawnFailures = 0;
/** Pending realm-reader respawn timer. @type {NodeJS.Timeout | null} */
let realmRespawnTimer = null;
/** @type {import("node:child_process").ChildProcess | null} */
let overlayChild = null;
/** Arg token the running overlay child was spawned with (--url=…). */
let overlayAppliedUrlArg = null;
/** @type {string | null} */
let overlayAppliedOutput = null;
/** Restart nonce the running overlay child was spawned under. */
let overlayAppliedRestartAt = null;
/** Timestamp of the last overlay host spawn (liveness respawn rate limit). */
let overlaySpawnedAt = 0;
/** When the current overlay child exited (ms), for the DD-10 uptime check. */
let overlayExitedAt = 0;
/** Overlay host setting poll timer. @type {NodeJS.Timeout | null} */
let overlayPollTimer = null;
/** Delay the current overlay poll timer was armed with. */
let overlayPollDelay = 0;
/** Timestamp of the last server spawn (used for exit diagnostics). */
let serverSpawnedAt = 0;
/**
 * Timestamp the running server child was last observed healthy (D-NEW-2), or 0
 * when it never passed its health probe. The respawn policy measures a run's
 * "uptime" from here, so a child that stays alive but never serves healthz
 * cannot look stable. Reset on every spawn and every exit.
 */
let serverHealthyAt = 0;
/** Consecutive short-lived server runs (respawnPolicy input). */
let serverRespawnFailures = 0;
/** Pending server respawn timer. @type {NodeJS.Timeout | null} */
let serverRespawnTimer = null;
/** Bumped per server respawn attempt so a stale waitForServer continuation bails. */
let serverWaitId = 0;
/** @type {Map<string, number>} */
const childLogFdByLabel = new Map();
/** Log path for each open child log fd (DD-5 in-session cap). @type {Map<string, string>} */
const childLogPathByLabel = new Map();
/**
 * DD-5: child logs share a long-lived fd with the child, so they are also
 * size-checked on a timer while the child runs (not only on respawn).
 */
const CHILD_LOG_SIZE_CHECK_MS = 15_000;
/** @type {NodeJS.Timeout | null} */
let childLogCapTimer = null;
let shuttingDown = false;
/** @type {string | null} */
let desktopLogPath = null;
const processStartedAt = Date.now();

const PORT = Number(process.env.ROXYSU_PORT ?? 4321);
const HOST = process.env.ROXYSU_HOST ?? "127.0.0.1";
const APP_ORIGIN = appOrigin(HOST, PORT);
/**
 * DD-2: per-launch token handed to the server child (ROXYSU_INSTANCE_TOKEN)
 * and echoed by its /api/system/healthz. waitForServer only accepts a server
 * carrying it, so a stale orphan or a dev server on the same port is never
 * adopted as this launch's child.
 */
const INSTANCE_TOKEN = randomUUID();
const WINDOW_READY_MARKER = "electron-window-ready";
/** Caps a session-share PNG before nativeImage decode. Checked in clipboardImage.js. */
/**
 * L4: every shell/child log is capped at `DEFAULT_MAX_LOG_BYTES` (10 MiB) with
 * a single `.1` backup, so a wedged child that spams stderr cannot fill the
 * user's disk. desktop.log is stat'ed at most this often, not on every line.
 */
const DESKTOP_LOG_SIZE_CHECK_MS = 30_000;
/** Last time desktop.log's size was checked for rotation. */
let desktopLogSizeCheckedAt = 0;
/** Aborted when shutdown starts, or when a newer wait replaces it (DD-12). */
/** @type {AbortController | null} */
let startupAbort = null;
/**
 * DD-12: loadURL → realm → overlay → updater runs once. A boot crash's
 * respawn must not do that path a second time.
 */
const finishStartupOnce = createOnceGuard();

/** Durations use a monotonic clock so suspend / NTP cannot trip them (DD-25). */
function monoNow() {
  return performance.now();
}

/**
 * Abort the previous health wait before arming a new one, so a boot crash
 * cannot leave two continuations racing into loadURL (DD-12).
 * @returns {AbortSignal}
 */
function replaceStartupAbort() {
  if (startupAbort) startupAbort.abort();
  startupAbort = new AbortController();
  return startupAbort.signal;
}

/**
 * Resolve a writable log dir before whenReady (userData may still work via env/name).
 */
function earlyDataDir() {
  if (process.env.ROXYSU_DATA_DIR?.trim()) return process.env.ROXYSU_DATA_DIR.trim();
  try {
    return app.getPath("userData");
  } catch {
    if (process.platform === "win32") {
      const base = process.env.APPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Roaming");
      return path.join(base, "Roxysu");
    }
    if (process.platform === "darwin") {
      const home = process.env.HOME || ".";
      return path.join(home, "Library", "Application Support", "Roxysu");
    }
    const home = process.env.HOME || ".";
    return path.join(home, ".config", "Roxysu");
  }
}

/**
 * Rotate desktop.log once it passes the cap (L4). Throttled: the file is
 * stat'ed at most every DESKTOP_LOG_SIZE_CHECK_MS, so the hot logging path
 * stays a single append. Never throws.
 * @param {string} logPath
 */
function maybeRotateDesktopLog(logPath) {
  const now = Date.now();
  if (now - desktopLogSizeCheckedAt < DESKTOP_LOG_SIZE_CHECK_MS) return;
  desktopLogSizeCheckedAt = now;
  try {
    rotateIfLarger(logPath, DEFAULT_MAX_LOG_BYTES, {
      onError: (err) => console.error(`[roxysu-desktop] desktop.log rotate failed: ${err}`),
    });
  } catch {
    // ignore — logging must never block startup
  }
}

/**
 * @param {string} message
 */
function desktopLog(message) {
  const line = `${new Date().toISOString()} (+${Date.now() - processStartedAt}ms) ${message}\n`;
  try {
    if (!desktopLogPath) {
      const logDir = path.join(earlyDataDir(), "logs");
      fs.mkdirSync(logDir, { recursive: true });
      desktopLogPath = path.join(logDir, "desktop.log");
    }
    maybeRotateDesktopLog(desktopLogPath);
    fs.appendFileSync(desktopLogPath, line);
  } catch {
    // ignore — logging must never block startup
  }
  console.log(`[roxysu-desktop] ${message}`);
}

desktopLog(`process_start pid=${process.pid} packaged=${String(app.isPackaged)} exec=${process.execPath}`);

/**
 * Optional handoff marker for older Win32 stubs that waited on a visible window.
 * @param {string} dataDir
 */
function signalWindowReady(dataDir) {
  try {
    const marker = path.join(dataDir, "logs", WINDOW_READY_MARKER);
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, `${Date.now()}\n`, "utf8");
  } catch (err) {
    desktopLog(`window-ready marker failed: ${err}`);
  }
}

/**
 * Open (or reuse) the append fd for a child log and write the start banner.
 *
 * L4: child logs share a long-lived fd for the whole session and get no
 * per-write size check, so the file is capped whenever a child (re)starts:
 * an over-cap log is closed, renamed to `<label>.log.1`, and reopened. The fd
 * is closed *before* the rename so the live file cannot keep writing into the
 * backup (and Windows refuses to rename an open file).
 *
 * @param {string} dataDir
 * @param {string} label
 */
function openChildLogFd(dataDir, label) {
  const logPath = path.join(dataDir, "logs", `${label}.log`);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (shouldRotate(fileSizeOrZero(logPath), DEFAULT_MAX_LOG_BYTES)) {
    const cached = childLogFdByLabel.get(label);
    if (cached != null) {
      try {
        fs.closeSync(cached);
      } catch {
        // already closed
      }
      childLogFdByLabel.delete(label);
      childLogPathByLabel.delete(label);
    }
    rotateIfLarger(logPath, DEFAULT_MAX_LOG_BYTES, {
      onError: (err) =>
        console.error(`[roxysu-desktop] ${label}.log rotate failed: ${err}`),
    });
  }
  let fd = childLogFdByLabel.get(label);
  if (fd == null) {
    fd = fs.openSync(logPath, "a");
    childLogFdByLabel.set(label, fd);
    childLogPathByLabel.set(label, logPath);
    startChildLogCap();
    desktopLog(`${label} log: ${logPath}`);
  }
  fs.writeSync(fd, `\n--- ${new Date().toISOString()} starting ${label} ---\n`);
  return { logPath, fd };
}

/**
 * DD-5: cap every open child log while its child keeps writing. Copy-truncate
 * (see logRotation.js) because the child holds the same append-mode fd.
 */
function capChildLogsNow() {
  for (const [label, fd] of childLogFdByLabel) {
    const logPath = childLogPathByLabel.get(label);
    if (!logPath) continue;
    const rotated = copyTruncateIfLarger(fd, logPath, DEFAULT_MAX_LOG_BYTES, {
      onError: (err) => desktopLog(`${label}.log in-session rotate failed: ${err}`),
    });
    if (rotated) {
      try {
        fs.writeSync(fd, `--- ${new Date().toISOString()} ${label}.log rotated (size cap) ---\n`);
      } catch {
        // fd closed under us
      }
      desktopLog(`${label}.log rotated in-session (over ${DEFAULT_MAX_LOG_BYTES} bytes)`);
    }
  }
}

function startChildLogCap() {
  if (childLogCapTimer) return;
  childLogCapTimer = setInterval(capChildLogsNow, CHILD_LOG_SIZE_CHECK_MS);
  childLogCapTimer.unref();
}

/**
 * Swallow spawn `'error'` (ENOENT / EACCES). That event does not emit `'exit'`.
 * @param {import("node:child_process").ChildProcess} child
 * @param {string} label
 * @param {(err: Error) => void} onFailure
 */
function watchChildError(child, label, onFailure) {
  child.on("error", (err) => {
    desktopLog(`${label} spawn failed: ${err.message}`);
    onFailure(err);
  });
}

function resolveTsx(repoRoot, serverDir, realmDir) {
  const candidates = [
    path.join(serverDir, "node_modules", ".bin", "tsx"),
    path.join(realmDir, "node_modules", ".bin", "tsx"),
    repoRoot ? path.join(repoRoot, "node_modules", ".bin", "tsx") : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "npx";
}

/**
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {string} entry
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} extraEnv
 * @param {string} label
 * @param {string[]} [nodeArgs] optional Node CLI args prepended to the entry
 */
function spawnNodeEntry(paths, entry, cwd, extraEnv, label, nodeArgs = []) {
  const env = { ...process.env, ...extraEnv };
  // Nix wrappers put Chromium libs on LD_LIBRARY_PATH. Node and its .node
  // addons must see only libstdc++, zlib, openssl, and icu. Unset on dev
  // and Windows, where the inherited path is the right one.
  const libraryPath = process.env.ROXYSU_LIBRARY_PATH?.trim();
  if (libraryPath) env.LD_LIBRARY_PATH = libraryPath;
  if (env.NODE_OPTIONS) desktopLog(`${label} NODE_OPTIONS=${env.NODE_OPTIONS}`);
  // DD-1: stdin is a pipe the child watches (attachParentLifeline). When this
  // process exits for any reason the OS closes it and the child shuts down
  // instead of surviving as an orphan on the port / local mirror.
  env.ROXYSU_PARENT_LIFELINE = "1";

  if (paths.isPackaged || entry.endsWith(".js")) {
    const { fd } = openChildLogFd(paths.dataDir, label);
    const nodeBin = paths.nodeBin;
    if (nodeBin && fs.existsSync(nodeBin)) {
      desktopLog(`spawn ${label} via nodeBin=${nodeBin}`);
      return withLifeline(spawn(nodeBin, [...nodeArgs, entry], {
        cwd,
        env,
        stdio: ["pipe", fd, fd],
        windowsHide: true,
        shell: false,
      }));
    }
    // Fallback: Electron as Node (dev packs / missing bundled node).
    desktopLog(`spawn ${label} via ELECTRON_RUN_AS_NODE exec=${process.execPath}`);
    return withLifeline(spawn(process.execPath, [...nodeArgs, entry], {
      cwd,
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["pipe", fd, fd],
      windowsHide: true,
      shell: false,
    }));
  }

  const tsxBin = resolveTsx(paths.repoRoot, paths.serverDir, paths.realmDir);
  const cmd = tsxBin === "npx" ? "npx" : tsxBin;
  const cmdArgs = tsxBin === "npx" ? ["tsx", entry] : [entry];
  return withLifeline(spawn(cmd, cmdArgs, {
    cwd,
    env,
    stdio: ["pipe", "inherit", "inherit"],
    windowsHide: true,
    shell: process.platform === "win32",
  }));
}

/**
 * DD-1: keep the lifeline pipe quiet. Writing is never done, but closing it
 * on a child that already exited can raise EPIPE on the stream.
 * @param {import("node:child_process").ChildProcess} child
 */
function withLifeline(child) {
  child.stdin?.on("error", () => {});
  return child;
}

/**
 * Send http(s) and osu: to the OS. Other schemes are ignored.
 * @param {string} url
 */
function openExternalSafe(url) {
  if (!canOpenExternal(url)) return;
  desktopLog(`openExternal (navigation) ${redactUrlForLog(url)}`);
  void shell.openExternal(url).catch((err) => {
    desktopLog(`openExternal failed: ${err}`);
  });
}

/**
 * Keep the preload on the app origin. New windows are denied so a
 * target=_blank page cannot inherit roxysuDesktop. In-place osu:// and
 * http(s) navigations go to the system instead of blanking this window.
 * @param {BrowserWindow} win
 */
function attachWindowGuards(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });

  const blockOffApp = (event, url) => {
    if (isAppUrl(url, APP_ORIGIN)) return;
    event.preventDefault();
    openExternalSafe(url);
  };
  win.webContents.on("will-navigate", blockOffApp);
  win.webContents.on("will-redirect", blockOffApp);
}

/**
 * @param {Electron.IpcMainInvokeEvent} event
 */
function ipcSenderIsApp(event) {
  const frameUrl = event.senderFrame?.url;
  if (typeof frameUrl === "string" && frameUrl.length > 0) {
    return senderIsApp(frameUrl, APP_ORIGIN);
  }
  try {
    return senderIsApp(event.sender?.getURL?.() ?? "", APP_ORIGIN);
  } catch {
    return false;
  }
}

/**
 * One-shot Chromium HTTP cache wipe after upgrades that change response headers
 * for the same hashed URLs (e.g. empty MIME → correct MIME). Do NOT clear every
 * launch — that makes Windows .exe startups feel extremely slow.
 * Bump CACHE_EPOCH when a future fix needs another forced wipe.
 */
const CACHE_EPOCH = "mime-fix-1";

/**
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 */
async function maybeClearHttpCache(paths) {
  const markerPath = path.join(paths.dataDir, "http-cache-epoch");
  const token = `${app.getVersion()}:${CACHE_EPOCH}`;
  try {
    if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf8") === token) {
      return;
    }
    desktopLog(`clearCache start (${token})`);
    const { session } = require("electron");
    await session.defaultSession.clearCache();
    fs.writeFileSync(markerPath, token, "utf8");
    desktopLog(`clearCache done (${token})`);
  } catch (err) {
    desktopLog(`clearCache failed: ${err}`);
  }
}

/**
 * App icon for the window / taskbar (Linux especially needs this; otherwise Electron's default).
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 */
function resolveAppIcon(paths) {
  const candidates = [
    path.join(paths.staticDir, "icons", "icon-512.png"),
    path.join(__dirname, "..", "server", "public", "icons", "icon-512.png"),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 */
function resolveSplashHtml(paths) {
  const candidates = [
    path.join(paths.resourcesDir || "", "splash.html"),
    path.join(__dirname, "splash.html"),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return path.join(__dirname, "splash.html");
}

/**
 * Show a local splash immediately so startup wait for the API isn't a blank desktop.
 * Never await clearCache / children before this — on Windows that can mean minutes of
 * no window while Defender + Chromium cache wipe run.
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 */
function createSplashWindow(paths) {
  const splashPath = resolveSplashHtml(paths);
  desktopLog(`createSplashWindow splash=${splashPath} exists=${fs.existsSync(splashPath)}`);

  const icon = resolveAppIcon(paths);
  if (icon) desktopLog(`app icon=${icon}`);
  else desktopLog("app icon missing — using Electron default");

  // DD-8: restore size / position / maximized / zoom from the last session.
  const windowState = loadWindowState();
  windowZoomLevel = windowState.zoomLevel;
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    ...(windowState.x !== undefined && windowState.y !== undefined
      ? { x: windowState.x, y: windowState.y }
      : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: "Roxysu",
    show: true,
    backgroundColor: "#12141a",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // L3: the preload only needs contextBridge + ipcRenderer, both available
      // in a sandboxed renderer. Sandboxing adds OS-level containment for a
      // window that renders remote-ish content (cover art, hub pages).
      sandbox: true,
    },
  });

  attachWindowGuards(mainWindow);
  if (windowState.maximized) mainWindow.maximize();
  trackWindowState(mainWindow);
  attachShellShortcuts(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    desktopLog(`splash did-fail-load code=${code} desc=${desc} url=${redactUrlForLog(url)}`);
  });

  attachRendererRecovery(mainWindow);

  void mainWindow
    .loadFile(splashPath)
    .then(() => {
      desktopLog("splash loadFile ok");
    })
    .catch((err) => {
      desktopLog(`splash loadFile failed: ${err}`);
    });

  // Once per start. Dark chrome is already a visible window for older stubs,
  // including when the HTML fails to load.
  signalWindowReady(paths.dataDir);
}

/** DD-9: page zoom (Chromium level), persisted with the window state. */
let windowZoomLevel = 0;
/** Debounced window-state save for the current window (set by trackWindowState). */
let scheduleWindowStateSave = () => {};

function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

/** @returns {import("./windowState").WindowState} */
function loadWindowState() {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(windowStatePath(), "utf8"));
  } catch {
    // first run or unreadable file → defaults
  }
  let displays = [];
  try {
    displays = screen.getAllDisplays();
  } catch {
    // screen unavailable → size limits only
  }
  return sanitizeWindowState(raw, displays);
}

/**
 * DD-8: save bounds (normal, i.e. un-maximized), maximized and zoom, debounced
 * on move/resize and synchronously on close.
 * @param {BrowserWindow} win
 */
function trackWindowState(win) {
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  const write = (sync) => {
    if (win.isDestroyed()) return;
    const body = JSON.stringify(
      serializeWindowState(win.getNormalBounds(), win.isMaximized(), windowZoomLevel),
    );
    try {
      if (sync) {
        fs.writeFileSync(windowStatePath(), body);
      } else {
        fs.writeFile(windowStatePath(), body, () => {});
      }
    } catch (err) {
      desktopLog(`window state save failed: ${err}`);
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      write(false);
    }, 500);
  };
  scheduleWindowStateSave = schedule;
  for (const event of ["resize", "move", "maximize", "unmaximize"]) {
    win.on(/** @type {any} */ (event), schedule);
  }
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    timer = null;
    write(true);
  });
  // Zoom is per page load; re-apply the saved level on every app page.
  win.webContents.on("did-finish-load", () => {
    if (win.isDestroyed()) return;
    if (isAppUrl(win.webContents.getURL(), APP_ORIGIN)) {
      win.webContents.setZoomLevel(windowZoomLevel);
    }
  });
}

/**
 * DD-9: Ctrl/Cmd +, −, 0 zoom; Ctrl+R / F5 reload; F11 fullscreen; F12
 * dev tools in dev builds. Windows/Linux have no menu to provide them.
 * @param {BrowserWindow} win
 */
function attachShellShortcuts(win) {
  win.webContents.on("before-input-event", (event, input) => {
    const action = shortcutFor(input, { allowDevTools: !app.isPackaged });
    if (!action) return;
    event.preventDefault();
    const wc = win.webContents;
    const setZoom = (level) => {
      windowZoomLevel = clampZoomLevel(level);
      wc.setZoomLevel(windowZoomLevel);
      scheduleWindowStateSave();
    };
    switch (action) {
      case "zoom-in":
        setZoom(windowZoomLevel + ZOOM_STEP);
        break;
      case "zoom-out":
        setZoom(windowZoomLevel - ZOOM_STEP);
        break;
      case "zoom-reset":
        setZoom(0);
        break;
      case "reload":
        wc.reload();
        break;
      case "fullscreen":
        win.setFullScreen(!win.isFullScreen());
        break;
      case "devtools":
        wc.toggleDevTools();
        break;
    }
    desktopLog(`shortcut ${action}${action.startsWith("zoom") ? ` level=${windowZoomLevel}` : ""}`);
  });
}

let rendererCrashes = 0;
let rendererLastCrashAt = 0;
let unresponsivePromptOpen = false;

/**
 * DD-7: a renderer crash or OOM used to leave a dead window until restart,
 * with nothing logged. Reload (keeping the route) up to 3 times per minute,
 * then end with the fatal dialog. A hung renderer gets a Wait / Reload prompt.
 * @param {BrowserWindow} win
 */
function attachRendererRecovery(win) {
  win.webContents.on("render-process-gone", (_e, details) => {
    desktopLog(`renderer gone reason=${details.reason} exitCode=${details.exitCode}`);
    if (shuttingDown) return;
    const now = Date.now();
    const decision = decideRendererGone({
      reason: details.reason,
      crashes: rendererCrashes,
      lastCrashAt: rendererLastCrashAt,
      now,
    });
    if (decision.action === "ignore") return;
    rendererCrashes = decision.crashes;
    rendererLastCrashAt = now;
    if (decision.action === "fatal") {
      void failFatal("renderer-crash-loop", { error: details.reason });
      return;
    }
    setTimeout(() => {
      if (shuttingDown || win.isDestroyed()) return;
      desktopLog(`renderer reload after crash #${rendererCrashes}`);
      void reloadKeepingRoute().catch((err) => desktopLog(`renderer reload failed: ${err}`));
    }, 1000);
  });

  win.on("unresponsive", () => {
    desktopLog("renderer unresponsive");
    if (unresponsivePromptOpen || shuttingDown || win.isDestroyed()) return;
    unresponsivePromptOpen = true;
    void dialog
      .showMessageBox(win, {
        type: "warning",
        title: "Roxysu",
        message: "Roxysu is not responding",
        detail: "The page may still be working. Reload it if it stays frozen.",
        buttons: ["Wait", "Reload"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      .then(({ response }) => {
        desktopLog(`unresponsive prompt answer=${response === 1 ? "reload" : "wait"}`);
        if (response !== 1 || win.isDestroyed()) return;
        // A hung renderer cannot process a reload; crash it first. The
        // render-process-gone handler above then reloads it.
        win.webContents.forcefullyCrashRenderer();
      })
      .catch((err) => desktopLog(`unresponsive prompt failed: ${err}`))
      .finally(() => {
        unresponsivePromptOpen = false;
      });
  });

  win.on("responsive", () => desktopLog("renderer responsive again"));
}

/**
 * DD-6: tell the app page (only an app-origin page; the preload exposes it as
 * roxysuDesktop.onServerState) that the local server is down / back.
 * @param {import("./windowRecovery").ServerState} payload
 */
function sendServerState(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (!isAppUrl(wc.getURL(), APP_ORIGIN)) return;
  try {
    wc.send(SERVER_STATE_CHANNEL, payload);
  } catch (err) {
    desktopLog(`server-state send failed: ${err}`);
  }
}

/**
 * DD-6: after a server respawn (or a renderer crash) reload the page in
 * place when it is the app, so #/route survives; otherwise load the root.
 */
async function reloadKeepingRoute() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (reloadActionFor(wc.getURL(), APP_ORIGIN) === "reload") {
    desktopLog("reload in place (route kept)");
    wc.reload();
    return;
  }
  await loadAppIntoWindow();
}

/**
 * L5: the shell has no menu of its own, but macOS gives every app a menu bar
 * and needs standard roles for ⌘Q, copy/paste and window management. Build a
 * minimal standard menu there; Windows/Linux keep no application menu.
 * @returns {Electron.Menu | null}
 */
function buildApplicationMenu() {
  if (process.platform !== "darwin") return null;
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]);
}

/** One start at a time so a slow extract cannot spawn two readers. */
/** @type {Promise<"running" | "failed" | "spawned"> | null} */
let realmStartPromise = null;

/**
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {NodeJS.ProcessEnv} sharedEnv
 * @returns {Promise<"running" | "failed" | "spawned">}
 */
function spawnRealmReader(paths, sharedEnv) {
  if (realmStartPromise) return realmStartPromise;
  const job = startRealmReader(paths, sharedEnv);
  realmStartPromise = job.finally(() => {
    realmStartPromise = null;
  });
  return realmStartPromise;
}

/**
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {NodeJS.ProcessEnv} sharedEnv
 * @returns {Promise<"running" | "failed" | "spawned">}
 */
async function startRealmReader(paths, sharedEnv) {
  // An exited child is not "killed", so check exit state, not `killed`.
  // Signal death leaves exitCode null; childIsAlive treats that as dead.
  if (childIsAlive(realmChild)) return "running";
  if (shuttingDown) return "failed";
  try {
    await ensureRealmExtracted(paths);
  } catch (err) {
    desktopLog(`realm extract failed: ${err}`);
    return "failed";
  }
  // Quit during extract must not spawn a reader that shutdown already missed.
  if (shuttingDown) return "failed";
  if (childIsAlive(realmChild)) return "running";
  if (!fs.existsSync(paths.realmEntry)) {
    desktopLog(`realm entry missing: ${paths.realmEntry}`);
    return "failed";
  }
  desktopLog(`spawn realm-reader dir=${paths.realmDir}`);
  // Opt-in heap guardrail: REALM_MAX_OLD_SPACE_MB=1536 caps V8 old space for
  // the reader only (server keeps defaults). Unset = no flag, as before.
  const realmHeapMb = Number(process.env.REALM_MAX_OLD_SPACE_MB || 0);
  const realmNodeArgs =
    Number.isFinite(realmHeapMb) && realmHeapMb > 0
      ? [`--max-old-space-size=${Math.floor(realmHeapMb)}`]
      : [];
  if (realmNodeArgs.length > 0) {
    desktopLog(`realm-reader heap cap: ${realmNodeArgs[0]}`);
  }
  realmChild = spawnNodeEntry(
    paths,
    paths.realmEntry,
    paths.realmDir,
    sharedEnv,
    "realm-reader",
    realmNodeArgs,
  );
  const child = realmChild;
  realmSpawnedAt = monoNow();
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    // A replaced/stopped child (not the current one) must not trigger respawn.
    if (child !== realmChild) return;
    desktopLog(`realm-reader exited code=${code} signal=${signal}`);
    scheduleRealmRespawn(paths, sharedEnv);
  });
  watchChildError(child, "realm-reader", () => {
    if (shuttingDown) return;
    if (child !== realmChild) return;
    scheduleRealmRespawn(paths, sharedEnv);
  });
  return "spawned";
}

/**
 * F-037: respawn realm-reader after an unexpected exit with exponential
 * backoff (see respawnPolicy.js). Never runs during shutdown.
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {NodeJS.ProcessEnv} sharedEnv
 */
function scheduleRealmRespawn(paths, sharedEnv) {
  if (shuttingDown || realmRespawnTimer) return;
  const decision = decideRespawn({
    failures: realmRespawnFailures,
    uptimeMs: monoNow() - realmSpawnedAt,
  });
  realmRespawnFailures = decision.failures;
  if (decision.action === "give-up") {
    desktopLog(
      `realm-reader respawn giving up after ${decision.failures - 1} consecutive short-lived runs — restart Roxysu to retry`,
    );
    return;
  }
  desktopLog(
    `realm-reader respawn #${decision.failures} in ${decision.delayMs}ms`,
  );
  realmRespawnTimer = setTimeout(() => {
    realmRespawnTimer = null;
    if (shuttingDown) return;
    void spawnRealmReader(paths, sharedEnv)
      .then((result) => {
        if (result === "failed") scheduleRealmRespawn(paths, sharedEnv);
      })
      .catch((err) => {
        desktopLog(`realm-reader start failed: ${err}`);
        scheduleRealmRespawn(paths, sharedEnv);
      });
  }, decision.delayMs);
}

/**
 * Spawn the client-app server child and attach its respawn-aware handlers
 * (desktop M8). An unexpected exit no longer tears down the whole desktop
 * session with it — it goes through the respawn policy, and only an
 * exhausted budget ends the app. The realm-reader and the In-game overlay
 * host keep running: the overlay stops itself after its poll-failure cap
 * and comes back once the server answers settings polls again.
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {NodeJS.ProcessEnv} sharedEnv
 * @returns {import("node:child_process").ChildProcess}
 */
function spawnServer(paths, sharedEnv) {
  desktopLog("spawn server");
  const child = spawnNodeEntry(
    paths,
    paths.serverEntry,
    paths.serverDir,
    // Backfill jobs force a collection between maps to keep note graphs from
    // accumulating (jobYield.ts). Node only exposes `global.gc` with
    // --expose-gc; via NODE_OPTIONS it reaches both the packaged binary and
    // dev `tsx`, which drops positional node args. Scoped to this child —
    // Electron itself must not get the flag.
    {
      ...sharedEnv,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--expose-gc"]
        .filter(Boolean)
        .join(" "),
    },
    "server",
  );
  serverSpawnedAt = monoNow();
  // D-NEW-2: a fresh run is not healthy until its health probe passes. A
  // stale timestamp here would make a never-healthy child look stable.
  serverHealthyAt = 0;
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    // A replaced/stopped child (not the current one) must not trigger respawn.
    if (child !== serverChild) return;
    desktopLog(
      `server exited code=${code} signal=${signal} after ${Math.round(monoNow() - serverSpawnedAt)}ms ` +
        `(healthy=${serverHealthyAt ? `${Math.round(monoNow() - serverHealthyAt)}ms` : "never"})`,
    );
    // DD-2: a server that cannot bind its port never will — respawning only
    // loops (and used to adopt whatever else answered healthz). Fail now.
    if (classifyServerExit(code) === "addr-in-use") {
      void failFatal("port-in-use");
      return;
    }
    // Read the health stamp *before* clearing it: the policy must see how long
    // this run was actually serving healthz. spawnServer clears it again for
    // the next run.
    scheduleServerRespawn(paths, sharedEnv);
    serverHealthyAt = 0;
  });
  watchChildError(child, "server", () => {
    if (shuttingDown) return;
    if (child !== serverChild) return;
    scheduleServerRespawn(paths, sharedEnv);
  });
  return child;
}

/**
 * Respawn the server child after an unexpected exit with the same
 * exponential backoff as the realm-reader (respawnPolicy.js). A run that
 * stayed healthy for at least `stableUptimeMs` resets the counter, so a single
 * crash on a long-lived session restarts after 2 s; a server that dies at boot
 * — or that stays alive but never passes `/api/system/healthz` (D-NEW-2) —
 * gives up after `maxAttempts` instead of spinning forever.
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {NodeJS.ProcessEnv} sharedEnv
 */
function scheduleServerRespawn(paths, sharedEnv) {
  if (shuttingDown || serverRespawnTimer) return;
  const decision = decideRespawn({
    failures: serverRespawnFailures,
    // Uptime counts from the last successful health probe, not from spawn:
    // a process that never served healthz has 0 healthy uptime no matter how
    // long it stayed alive.
    healthyAt: serverHealthyAt || null,
    now: monoNow(),
  });
  serverRespawnFailures = decision.failures;
  if (decision.action === "give-up") {
    desktopLog(
      `server respawn giving up after ${decision.failures - 1} consecutive short-lived runs — restart Roxysu to retry`,
    );
    void failFatal("respawn-exhausted");
    return;
  }
  desktopLog(`server respawn #${decision.failures} in ${decision.delayMs}ms`);
  void setSplashStatus(splashStatus(app.getLocale(), "restarting"));
  sendServerState(serverStateForRespawn(decision, DEFAULT_RESPAWN_CONFIG.maxAttempts));
  serverRespawnTimer = setTimeout(() => {
    serverRespawnTimer = null;
    if (shuttingDown) return;
    void respawnServer(paths, sharedEnv);
  }, decision.delayMs);
}

/**
 * Last bytes of a log file, or "" when missing. Never throws.
 * @param {string} logPath
 */
function readLogTail(logPath) {
  try {
    const fd = fs.openSync(logPath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, FATAL_LOG_TAIL_BYTES);
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, size - length);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

let fatalShown = false;

/**
 * End the session after an unrecoverable failure (DD-3). Shows a dialog with
 * the reason, who holds the port, the last server.log lines and the logs
 * path, with Open logs folder / Retry / Quit — instead of a splash message
 * that disappeared with the window a few milliseconds later.
 * @param {import("./fatalReport").FatalReason} reason
 * @param {{ error?: string }} [extra]
 */
async function failFatal(reason, extra = {}) {
  if (fatalShown) return;
  fatalShown = true;
  desktopLog(`fatal: ${reason}${extra.error ? ` — ${extra.error}` : ""}`);
  const logsDir = path.join(earlyDataDir(), "logs");
  /** @type {import("./fatalReport").PortOwner | null} */
  let portOwner = null;
  if (reason === "port-in-use" || reason === "health-timeout" || reason === "respawn-exhausted") {
    const owner = await probePortOwner(PORT, HOST, { expectInstance: INSTANCE_TOKEN });
    if (owner.kind === "roxysu" || owner.kind === "other") portOwner = owner;
  }
  const { message, detail } = buildFatalReport({
    reason,
    port: PORT,
    portOwner,
    logTail: readLogTail(path.join(logsDir, "server.log")),
    logsDir,
    error: extra.error,
  });
  await setSplashStatus(message, { animateDots: false });
  desktopLog(`fatal dialog: ${message}${portOwner ? ` owner=${JSON.stringify(portOwner)}` : ""}`);
  let response = 2;
  try {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const options = {
      type: /** @type {const} */ ("error"),
      title: "Roxysu",
      message,
      detail,
      buttons: ["Open logs folder", "Retry", "Quit"],
      defaultId: 2,
      cancelId: 2,
      noLink: true,
    };
    ({ response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options));
  } catch (err) {
    desktopLog(`fatal dialog failed: ${err}`);
  }
  desktopLog(`fatal dialog answer=${["open-logs", "retry", "quit"][response] ?? response}`);
  if (response === 0) {
    const openErr = await shell.openPath(logsDir);
    if (openErr) desktopLog(`open logs folder failed: ${openErr}`);
  }
  try {
    await shutdown();
  } catch (err) {
    desktopLog(`shutdown failed: ${err}`);
  }
  if (response === 1) app.relaunch();
  app.exit(1);
}

/**
 * First successful health continuation: load the UI, then start the
 * realm-reader, the overlay host, and the updater. A boot-crash respawn
 * must not run this a second time (DD-12).
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {NodeJS.ProcessEnv} sharedEnv
 * @returns {Promise<boolean>} true when this call performed startup
 */
async function finishStartup(paths, sharedEnv) {
  if (shuttingDown) return false;
  if (!childIsAlive(serverChild)) {
    desktopLog("finishStartup skipped — server child is not alive");
    return false;
  }
  if (!finishStartupOnce.run(() => {})) return false;
  if (serverHealthyAt === 0) serverHealthyAt = monoNow();
  await setSplashStatus(splashStatus(app.getLocale(), "opening"));
  try {
    await maybeClearHttpCache(paths);
    await loadAppIntoWindow();
  } catch (err) {
    if (shuttingDown) return true;
    desktopLog(`loadAppIntoWindow failed: ${err}`);
    await failFatal("load-failed", { error: String(err?.message ?? err) });
    return true;
  }
  if (shuttingDown) return true;
  desktopLog("ready");

  // Defer Realm until the UI is up. Extract is async so the first packaged
  // launch does not freeze the window while tar runs.
  void spawnRealmReader(paths, sharedEnv)
    .then((result) => {
      if (result === "failed") scheduleRealmRespawn(paths, sharedEnv);
    })
    .catch((err) => {
      desktopLog(`realm-reader start failed: ${err}`);
      scheduleRealmRespawn(paths, sharedEnv);
    });

  // Optional Wayland in-game overlay host (bundled on NixOS packages):
  // spawns from the overlay.host_enabled / overlay.host_url settings and
  // restarts/stops on changes.
  watchOverlayHostSetting(paths);

  // NSIS installs only — check after UI is up so startup is not blocked.
  // DD-11: children must release node.exe and native addons before NSIS replaces them.
  startAutoUpdate({ log: desktopLog, beforeInstall: shutdown });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void (async () => {
        try {
          createSplashWindow(paths);
          await loadAppIntoWindow();
        } catch (err) {
          desktopLog(`activate load failed: ${err}`);
        }
      })();
    }
  });
  return true;
}

/**
 * Bring the server back after a respawn delay: spawn, wait for health, and
 * either finish the first startup or reload the window. A stale attempt bails
 * when a newer one (or shutdown) started while it waited.
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {NodeJS.ProcessEnv} sharedEnv
 */
async function respawnServer(paths, sharedEnv) {
  if (shuttingDown || childIsAlive(serverChild)) return;
  const waitId = ++serverWaitId;
  serverChild = spawnServer(paths, sharedEnv);
  const signal = replaceStartupAbort();
  try {
    // Shorter than the first boot: the previous run already had its restart
    // window, so a respawned child that cannot answer healthz within a minute
    // is counted as a failed run instead of holding the loop open for 3 min.
    await waitForServer(PORT, HOST, 60_000, {
      signal,
      expectInstance: INSTANCE_TOKEN,
      waitId,
    });
  } catch (err) {
    if (shuttingDown || waitId !== serverWaitId) return;
    desktopLog(`respawn waitForServer failed: ${err}`);
    // A live but never-healthy child must not wedge the loop: stop it so its
    // exit event drives the next policy round. A dead child already did.
    if (childIsAlive(serverChild)) void stopChild(serverChild, "server");
    return;
  }
  if (shuttingDown || waitId !== serverWaitId) return;
  if (!childIsAlive(serverChild)) {
    desktopLog("respawn health ok but server child is dead — not marking healthy");
    return;
  }
  // D-NEW-2: the run only counts as stable from here, not from spawn.
  serverHealthyAt = monoNow();
  if (await finishStartup(paths, sharedEnv)) return;
  desktopLog("server respawn ok — reloading window");
  sendServerState({ state: "up" });
  try {
    await reloadKeepingRoute();
  } catch (err) {
    desktopLog(`reload after server respawn failed: ${err}`);
  }
}

/**
 * Optional In-game overlay host (Wayland wlr-layer-shell). Bundled by the Nix
 * packages into resources/overlay (Rust `roxysu-overlay` → `roxysu-overlay-rs`).
 * Dev prefers a local cargo build. HTTP-only consumer of GET /api/overlay —
 * never touches Realm or the local mirror. Skipped on Windows (no layer-shell).
 * Override: ROXYSU_OVERLAY_BIN.
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 */
function resolveOverlayBin(paths) {
  const envBin = process.env.ROXYSU_OVERLAY_BIN?.trim();
  if (envBin) return fs.existsSync(envBin) ? envBin : null;
  const root = paths.repoRoot;
  const candidates = [
    path.join(paths.resourcesDir, "overlay", "roxysu-overlay"),
    root ? path.join(root, "apps", "overlay-rs", "target", "release", "roxysu-overlay-rs") : null,
    root ? path.join(root, "apps", "overlay-rs", "target", "debug", "roxysu-overlay-rs") : null,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const OVERLAY_URL_DEFAULT = `--url=http://${HOST}:${PORT}/#/overlay?bg=clear`;
const OVERLAY_RESPAWN_GAP_MS = 15000;
/**
 * D-NEW-1: long automatic age backstop for the overlay host. The host used to
 * run with the age cap disabled (`--watchdog-max-age-sec=0`) so a HUD refresh
 * would not interrupt play; that is fine for a session, not for a host left
 * running for days with a leak the FD/RSS caps miss. Six hours is long enough
 * to be invisible in practice and short enough to bound a slow leak, and the
 * host is respawned by the settings poll (the HUD reloads once).
 * Override: ROXYSU_OVERLAY_MAX_AGE_SEC (0 disables the cap explicitly).
 */
const DEFAULT_OVERLAY_MAX_AGE_SEC = 6 * 60 * 60;

/**
 * Parse the overlay age cap from an env-style string. Anything that is not a
 * plain non-negative integer falls back to the default (never a crash: this
 * value only feeds argv).
 * @param {string | undefined} raw
 * @returns {number}
 */
function parseOverlayMaxAgeSec(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return DEFAULT_OVERLAY_MAX_AGE_SEC;
  if (!/^\d+$/.test(text)) {
    desktopLog(
      `overlay max age rejected (not a non-negative integer): ${JSON.stringify(text.slice(0, 32))} — using ${DEFAULT_OVERLAY_MAX_AGE_SEC}s`,
    );
    return DEFAULT_OVERLAY_MAX_AGE_SEC;
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    desktopLog(
      `overlay max age rejected (out of range): ${text.slice(0, 32)} — using ${DEFAULT_OVERLAY_MAX_AGE_SEC}s`,
    );
    return DEFAULT_OVERLAY_MAX_AGE_SEC;
  }
  return value;
}

/**
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {string} urlArg Single `--url=…` token (clap keeps `=` inside the value).
 * @param {string | null} output Monitor connector or model, or null to follow osu!.
 */
function spawnOverlayHost(paths, urlArg, output) {
  if (process.platform !== "linux") return;
  if (!process.env.WAYLAND_DISPLAY) {
    desktopLog("overlay host skipped — no Wayland session");
    return;
  }
  const bin = resolveOverlayBin(paths);
  if (!bin) {
    desktopLog("overlay host not bundled — skipping");
    return;
  }
  const { fd } = openChildLogFd(paths.dataDir, "overlay");
  const maxAgeSec = parseOverlayMaxAgeSec(process.env.ROXYSU_OVERLAY_MAX_AGE_SEC);
  // DD-1: --exit-on-stdin-eof + a stdin pipe take the layer surface down
  // with the shell if it dies, instead of leaving an orphaned HUD on screen.
  const args = [urlArg, `--watchdog-max-age-sec=${maxAgeSec}`, "--exit-on-stdin-eof"];
  if (output) args.push(`--output=${output}`);
  const loggedArgs = args.map((arg) =>
    arg.startsWith("--url=")
      ? `--url=${redactUrlForLog(arg.slice("--url=".length))}`
      : arg,
  );
  desktopLog(
    `spawn overlay maxAgeSec=${maxAgeSec} bin=${bin} ${loggedArgs.join(" ")}`,
  );
  overlayAppliedUrlArg = urlArg;
  overlayAppliedOutput = output ?? null;
  // Do not set WEBKIT_DISABLE_DMABUF_RENDERER. On a transparent WebKitGTK
  // surface that fallback fills the whole window with grey on each HUD update.
  // The FD and RSS caps still exit 75 so a real leak recovers; the age cap is
  // now a long backstop (D-NEW-1) instead of off forever.
  overlayChild = withLifeline(spawn(bin, args, {
    stdio: ["pipe", fd, fd],
    windowsHide: true,
    shell: false,
  }));
  overlaySpawnedAt = monoNow();
  const child = overlayChild;
  child.on("exit", (code, signal) => {
    if (child === overlayChild) overlayExitedAt = monoNow();
    if (!shuttingDown) {
      desktopLog(`overlay exited code=${code} signal=${signal}`);
    }
  });
  // Poll respawns off exitCode !== null. A second schedule would double-spawn.
  watchChildError(child, "overlay", () => {});
}

/**
 * SIGTERM, then SIGKILL, then give up so Quit cannot wait forever.
 * Timing lives in stopChild.js.
 * @param {import("node:child_process").ChildProcess | null} child
 * @param {string} label
 * @returns {Promise<void>}
 */
function stopChild(child, label) {
  return stopChildProcess(child, label, { log: desktopLog });
}

/** Last host-config ETag, so a disabled overlay does not re-download the body. */
let overlayConfigEtag = null;
/** Last good host-config. A 304 reuses it instead of counting as a failed poll. */
let overlayConfigCache = null;

/**
 * Read the In-game overlay host config (`GET /api/overlay/host-config`).
 * Resolves null when unreachable or the body is not a trustworthy config —
 * a non-200 error body must count as a failed poll, not as "enabled with
 * the default HUD URL" (F-066). A 304 reuses the last good config (DD-14).
 */
function fetchOverlaySettings() {
  return new Promise((resolve) => {
    const headers = overlayConfigEtag
      ? { "if-none-match": overlayConfigEtag }
      : undefined;
    const req = http.get(
      { host: HOST, port: PORT, path: "/api/overlay/host-config", timeout: 2000, headers },
      (res) => {
        const etag = res.headers.etag;
        if (typeof etag === "string" && etag) overlayConfigEtag = etag;
        if (res.statusCode === 304) {
          res.resume();
          resolve(overlayConfigCache);
          return;
        }
        void readCappedBody(res, MAX_OVERLAY_SETTINGS_BYTES).then((body) => {
          const parsed = body.ok
            ? parseOverlayHostConfigResponse(res.statusCode ?? 0, body.text)
            : null;
          if (parsed) overlayConfigCache = parsed;
          resolve(parsed);
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

const OVERLAY_HOST_STATUS_FILE = "overlay-host-status.json";

/**
 * Tell Settings whether the overlay host is parked. `at` is a wall-clock
 * stamp, not a duration. The server treats a missing or invalid file as absent.
 * @param {string} dataDir
 * @param {{ state: "parked" | "running", reason: "unsupported" | "crash-loop" | null }} status
 */
function writeOverlayHostStatus(dataDir, status) {
  try {
    fs.writeFileSync(
      path.join(dataDir, OVERLAY_HOST_STATUS_FILE),
      JSON.stringify({ state: status.state, reason: status.reason, at: Date.now() }),
    );
  } catch (err) {
    desktopLog(`overlay host status write failed: ${err}`);
  }
}

/**
 * Defense in depth (L7): PATCH /settings validates overlay.host_url and
 * overlay.host_output, but the shell execs the host — re-check the values
 * read from GET /api/settings before they reach argv. A value that reached
 * the settings table without PATCH (manual edit, older import, a future
 * writer) must not point the WebKit view at an arbitrary origin or pin a
 * nonsense monitor. A rejected URL falls back to the default HUD URL; a
 * rejected monitor follows the osu! window; both are logged.
 */
function guardOverlaySettings(settings) {
  if (!settings) return settings;
  let hostUrl = settings.hostUrl ?? null;
  if (hostUrl != null && !parseOverlayHostUrl(hostUrl).ok) {
    desktopLog(
      `overlay hostUrl rejected — using default (${redactUrlForLog(hostUrl)})`,
    );
    hostUrl = null;
  }
  let output = settings.output ?? null;
  if (output != null && !parseOverlayOutput(output).ok) {
    desktopLog(
      `overlay output rejected — following osu! (${JSON.stringify(output.slice(0, 64))})`,
    );
    output = null;
  }
  return {
    enabled: settings.enabled,
    hostUrl,
    output,
    restartAt: settings.restartAt ?? null,
  };
}

/**
 * Watch the overlay.host_enabled / overlay.host_url settings; spawn/restart
 * the host child whenever they change (first tick performs the initial
 * spawn), and stop + hold the child while the toggle is off (also suppresses
 * the liveness respawn). Polls plain client-app HTTP — no private IPC (see
 * decisions/no-ipc-between-processes).
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 */
function watchOverlayHostSetting(paths) {
  if (process.platform !== "linux" || !process.env.WAYLAND_DISPLAY) return;
  if (!resolveOverlayBin(paths)) return;

  /** Consecutive failed settings polls (F-066). */
  let consecutiveFailures = 0;
  /** Last successfully read enable toggle; null until the first read. */
  let lastKnownEnabled = null;
  /** DD-10: quick liveness respawns in a row. */
  let respawnFailures = 0;
  /** DD-10: park reason already logged, so a parked host logs once. */
  let loggedParkReason = null;
  /** D2: one poll run in flight; a call mid-flight coalesces into one re-run. */
  const applyGate = createApplyGate();

  const apply = async () => {
    if (shuttingDown) return;
    if (!applyGate.begin()) return;
    try {
      const settings = guardOverlaySettings(await fetchOverlaySettings());
      if (shuttingDown) return;

      // Decision logic lives in overlayApplyPolicy.js (pure, unit-tested):
      // F-038 gap only for an unchanged URL. Repeated poll failures stop a
      // live host after the cap, whether or not the last known toggle was off.
      const decision = decideOverlayApply({
        settings,
        defaultUrlArg: OVERLAY_URL_DEFAULT,
        hasChild: overlayChild !== null,
        childExited: overlayChild !== null && !childIsAlive(overlayChild),
        appliedUrlArg: overlayAppliedUrlArg,
        appliedOutput: overlayAppliedOutput,
        appliedRestartAt: overlayAppliedRestartAt,
        spawnedAt: overlaySpawnedAt,
        now: monoNow(),
        respawnGapMs: OVERLAY_RESPAWN_GAP_MS,
        consecutiveFailures,
        lastKnownEnabled,
        respawnFailures,
        childExitCode: overlayChild?.exitCode ?? null,
        childUptimeMs:
          overlayChild && !childIsAlive(overlayChild) && overlayExitedAt >= overlaySpawnedAt
            ? overlayExitedAt - overlaySpawnedAt
            : null,
      });
      consecutiveFailures = decision.consecutiveFailures;
      lastKnownEnabled = decision.lastKnownEnabled;
      respawnFailures = decision.respawnFailures;

      if (decision.reason === "unsupported-session" || decision.reason === "respawn-exhausted") {
        if (loggedParkReason !== decision.reason) {
          loggedParkReason = decision.reason;
          const reason =
            decision.reason === "unsupported-session" ? "unsupported" : "crash-loop";
          writeOverlayHostStatus(paths.dataDir, { state: "parked", reason });
          desktopLog(
            decision.reason === "unsupported-session"
              ? "overlay parked: this session cannot host it (exit 78: no Wayland or no wlr-layer-shell). Change an overlay setting or press Restart to try again."
              : `overlay parked after ${respawnFailures} quick crashes. Change an overlay setting or press Restart to try again.`,
          );
        }
      } else if (decision.action !== "noop") {
        if (loggedParkReason) {
          writeOverlayHostStatus(paths.dataDir, { state: "running", reason: null });
        }
        loggedParkReason = null;
      }

      if (decision.action === "stop") {
        desktopLog(
          decision.reason === "disabled"
            ? "overlay disabled by setting — stopping host"
            : `overlay settings unreachable (${consecutiveFailures} polls) — stopping host`,
        );
      } else if (decision.action === "spawn") {
        if (decision.reason === "liveness-respawn") {
          desktopLog(
            `overlay liveness respawn ${respawnFailures}/${OVERLAY_MAX_RESPAWNS} (previous exit code=${overlayChild?.exitCode})`,
          );
        } else if (decision.reason === "url-changed") {
          desktopLog("overlay url changed — restarting host");
        } else if (decision.reason === "output-changed") {
          desktopLog("overlay monitor changed — restarting host");
        } else if (decision.reason === "restart-requested") {
          desktopLog("overlay restart requested — restarting host");
        }
      }
      // D2: the old host must be fully stopped (SIGTERM, SIGKILL, deadline)
      // before a replacement spawns, so a URL/monitor restart can never
      // overlap two layer-shell hosts. Sequencing lives in
      // overlayApplyLoop.js (pure, unit-tested).
      await executeOverlayDecision(decision, {
        stop: () => stopChild(overlayChild, "overlay"),
        spawn: (urlArg, output) => {
          if (shuttingDown) return;
          // clap parses `--url=VALUE` / `--output=VALUE` as one argv token
          // and keeps `=` inside a value, so the URL and monitor each ride
          // in a single token (overlayApplyPolicy composes them).
          overlayChild = null;
          spawnOverlayHost(paths, urlArg, output);
          overlayAppliedRestartAt = decision.restartAt ?? null;
        },
      });
      if (decision.action === "stop") {
        overlayChild = null;
        overlayAppliedUrlArg = null;
        overlayAppliedOutput = null;
      }
    } catch (err) {
      // D2 residual: an unexpected throw from spawn/desktopLog/stop must not
      // become an unhandled rejection. Log it, keep the last known state, and
      // let the next poll (or the coalesced re-run below) try again.
      desktopLog(`overlay apply failed: ${err}`);
    } finally {
      if (applyGate.end() && !shuttingDown) {
        void apply();
      }
    }
  };

  // A leftover parked file from the previous process must not keep the
  // Settings line up until this session actually parks.
  writeOverlayHostStatus(paths.dataDir, { state: "running", reason: null });

  const tick = () => {
    void apply().finally(() => {
      if (!shuttingDown) armOverlayPoll(lastKnownEnabled);
    });
  };
  const armOverlayPoll = (enabled) => {
    const delay = overlaySettingsPollMs(enabled);
    if (overlayPollTimer && overlayPollDelay === delay) return;
    if (overlayPollTimer) clearInterval(overlayPollTimer);
    overlayPollDelay = delay;
    overlayPollTimer = setInterval(tick, delay);
    overlayPollTimer.unref();
  };

  void tick();
  armOverlayPoll(null);
}

/**
 * @param {string} text
 * @param {{ animateDots?: boolean }} [opts]
 */
async function setSplashStatus(text, opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const animateDots = opts.animateDots !== false;
  const safe = JSON.stringify(text);
  const lang = JSON.stringify(splashLang(app.getLocale()));
  try {
    await mainWindow.webContents.executeJavaScript(
      `(() => {
        document.documentElement.lang = ${lang};
        const el = document.getElementById("status");
        if (!el) return;
        el.classList.toggle("dots", ${animateDots ? "true" : "false"});
        el.textContent = ${safe};
      })()`,
    );
  } catch {
    // Splash may already have navigated away.
  }
}

async function loadAppIntoWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Main window missing when loading app");
  }
  const url = `http://${HOST}:${PORT}/`;
  desktopLog(`loadURL ${redactUrlForLog(url)}`);
  await mainWindow.loadURL(url);
}

function closeChildLogs() {
  for (const fd of childLogFdByLabel.values()) {
    try {
      fs.closeSync(fd);
    } catch {
      // already closed
    }
  }
  childLogFdByLabel.clear();
  childLogPathByLabel.clear();
  if (childLogCapTimer) {
    clearInterval(childLogCapTimer);
    childLogCapTimer = null;
  }
}

/** @type {Promise<void> | null} */
let shutdownPromise = null;

/**
 * Stops all children in parallel and resolves when they have exited. Safe to
 * call repeatedly — later callers await the same shutdown.
 * @returns {Promise<void>}
 */
function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  if (startupAbort) {
    startupAbort.abort();
    startupAbort = null;
  }
  if (overlayPollTimer) {
    clearInterval(overlayPollTimer);
    overlayPollTimer = null;
  }
  if (realmRespawnTimer) {
    clearTimeout(realmRespawnTimer);
    realmRespawnTimer = null;
  }
  if (serverRespawnTimer) {
    clearTimeout(serverRespawnTimer);
    serverRespawnTimer = null;
  }
  // Invalidate any in-flight respawn waitForServer continuation.
  serverWaitId += 1;
  const stops = [
    stopChild(overlayChild, "overlay"),
    stopChild(realmChild, "realm-reader"),
    stopChild(serverChild, "server"),
  ];
  overlayChild = null;
  realmChild = null;
  serverChild = null;
  shutdownPromise = Promise.all(stops).then(() => {
    closeChildLogs();
  });
  return shutdownPromise;
}

ipcMain.handle("roxysu:open-external", async (event, url) => {
  if (!ipcSenderIsApp(event)) {
    throw new Error("Invalid sender");
  }
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
  desktopLog(`openExternal ${redactUrlForLog(parsed.toString())}`);
  await shell.openExternal(parsed.toString());
});

ipcMain.handle("roxysu:write-clipboard-image", async (event, bytes) => {
  if (!ipcSenderIsApp(event)) {
    throw new Error("Invalid sender");
  }
  // Cap is checked before any copy. Array-likes are rejected so a huge
  // length cannot allocate before the check (DD-17).
  const buf = toImageBuffer(bytes);
  const image = nativeImage.createFromBuffer(buf);
  if (image.isEmpty()) {
    throw new Error("Invalid image");
  }
  clipboard.writeImage(image);
  desktopLog(`writeClipboardImage bytes=${buf.length}`);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  desktopLog("second_instance_lock_failed — quitting");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Stable Windows taskbar grouping / icon association.
  if (process.platform === "win32") {
    app.setAppUserModelId("dev.roxysu.desktop");
  }

  desktopLog("awaiting whenReady");
  app.whenReady().then(async () => {
    desktopLog("whenReady");
    const paths = resolveDesktopPaths(app);
    ensureParentDir(paths.dbPath);
    fs.mkdirSync(path.join(paths.dataDir, "backups"), { recursive: true });
    fs.mkdirSync(path.join(paths.dataDir, "logs"), { recursive: true });

    if (!fs.existsSync(path.join(paths.staticDir, "index.html"))) {
      desktopLog(
        `missing UI build at ${paths.staticDir}` +
          (paths.isPackaged ? "" : " — run: bun run --cwd apps/server build:ui"),
      );
      await failFatal("ui-missing", {
        error: `missing ${path.join(paths.staticDir, "index.html")}` +
          (paths.isPackaged ? "" : " — run: bun run --cwd apps/server build:ui"),
      });
      return;
    }

    desktopLog(`dataDir=${paths.dataDir}`);
    desktopLog(`dbPath=${paths.dbPath}`);
    desktopLog(`staticDir=${paths.staticDir}`);
    desktopLog(`nodeBin=${paths.nodeBin || "(none)"}`);
    desktopLog(`realmArchive=${paths.realmArchive || "(none)"}`);

    Menu.setApplicationMenu(buildApplicationMenu());

    createSplashWindow(paths);
    void setSplashStatus(splashStatus(app.getLocale(), "starting"));

    // Shipped calc bundle file (release artifact staged by after-pack/Nix).
    // Packaged boots apply it locally instead of pulling the Hub.
    const calcBundleFile = path.join(
      paths.resourcesDir,
      "calc-bundle.ndjson.gz",
    );
    const hasCalcBundleFile =
      paths.isPackaged && fs.existsSync(calcBundleFile);
    desktopLog(`calcBundleFile=${hasCalcBundleFile ? calcBundleFile : "(none)"}`);

    const sharedEnv = {
      ROXYSU_DESKTOP: "1",
      // Set only for Nix / electron-builder installs. `bun desktop` stays
      // unpackaged so a version bump does not replace the dev library.
      ...(paths.isPackaged ? { ROXYSU_PACKAGED: "1" } : {}),
      ...(hasCalcBundleFile
        ? { ROXYSU_CALC_BUNDLE_FILE: calcBundleFile }
        : {}),
      ROXYSU_PORT: String(PORT),
      ROXYSU_HOST: HOST,
      ROXYSU_INSTANCE_TOKEN: INSTANCE_TOKEN,
      ROXYSU_STATIC_DIR: paths.staticDir,
      ROXYSU_DATA_DIR: paths.dataDir,
      DB_PATH: paths.dbPath,
      ROXYSU_REALM_SCHEMA: paths.realmSchema,
      ROXYSU_REALM_READER_DIR: paths.realmDir,
      ROXYSU_MIGRATIONS_FOLDER: paths.migrationsFolder,
      // Packaged client talks to the public Hub. Override with HUB_URL.
      HUB_URL:
        process.env.HUB_URL?.trim() || "https://roxysu-api.yonx.app",
    };

    // M8: an unexpected server exit respawns with backoff instead of
    // quitting the whole desktop session (see spawnServer).
    serverChild = spawnServer(paths, sharedEnv);

    void setSplashStatus(splashStatus(app.getLocale(), "waiting"));
    desktopLog("waitForServer start");
    const waitId = ++serverWaitId;
    const signal = replaceStartupAbort();

    try {
      await waitForServer(PORT, HOST, 180_000, {
        signal,
        expectInstance: INSTANCE_TOKEN,
        waitId,
      });
    } catch (err) {
      // A respawn replaces this wait. That abort is not a health timeout.
      if (shuttingDown || waitId !== serverWaitId) return;
      desktopLog(`waitForServer failed: ${err}`);
      desktopLog(`see logs under ${path.join(paths.dataDir, "logs")}`);
      await failFatal("health-timeout", { error: String(err?.message ?? err) });
      return;
    }
    if (shuttingDown || waitId !== serverWaitId) return;
    if (!childIsAlive(serverChild)) {
      desktopLog("waitForServer ok but server child is dead — waiting for respawn");
      return;
    }

    desktopLog("waitForServer ok");
    // D-NEW-2: health reached — this run may now reset the respawn counter.
    serverHealthyAt = monoNow();
    await finishStartup(paths, sharedEnv);
  }).catch(async (err) => {
    desktopLog(`whenReady failed: ${err}`);
    if (shuttingDown) return;
    try {
      await shutdown();
    } catch (shutdownErr) {
      desktopLog(`shutdown failed: ${shutdownErr}`);
    }
    app.exit(1);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Hold the quit until every child has exited (SIGKILL after the grace
  // period, then a short deadline if the process never emits exit). Otherwise
  // children can outlive Electron and keep ROXYSU_PORT / the overlay surface.
  let quitAfterShutdown = false;
  app.on("before-quit", (event) => {
    if (quitAfterShutdown) return;
    event.preventDefault();
    void shutdown()
      .catch((err) => desktopLog(`shutdown failed: ${err}`))
      .finally(() => {
        quitAfterShutdown = true;
        app.quit();
      });
  });
}
