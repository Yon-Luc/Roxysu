const { app, BrowserWindow, Menu, ipcMain, shell, clipboard, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const { resolveDesktopPaths, ensureParentDir, ensureRealmExtracted } = require("./paths");
const { startAutoUpdate } = require("./auto-update");
const { decideRespawn } = require("./respawnPolicy");
const { decideOverlayApply, childIsAlive } = require("./overlayApplyPolicy");
const { createApplyGate, executeOverlayDecision } = require("./overlayApplyLoop");
const { appOrigin, isAppUrl, canOpenExternal, senderIsApp } = require("./urlPolicy");
const { stopChild: stopChildProcess } = require("./stopChild");
const { waitForServer } = require("./waitForServer");

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
/** Timestamp of the last overlay host spawn (liveness respawn rate limit). */
let overlaySpawnedAt = 0;
/** Overlay host setting poll timer. @type {NodeJS.Timeout | null} */
let overlayPollTimer = null;
/** @type {Map<string, number>} */
const childLogFdByLabel = new Map();
let shuttingDown = false;
/** @type {string | null} */
let desktopLogPath = null;
const processStartedAt = Date.now();

const PORT = Number(process.env.ROXYSU_PORT ?? 4321);
const HOST = process.env.ROXYSU_HOST ?? "127.0.0.1";
const APP_ORIGIN = appOrigin(HOST, PORT);
const WINDOW_READY_MARKER = "electron-window-ready";
/** Caps a session-share PNG before nativeImage decode. */
const MAX_CLIPBOARD_IMAGE_BYTES = 15 * 1024 * 1024;
/** Aborted when shutdown starts so a splash wait cannot finish into a dead window. */
/** @type {AbortController | null} */
let startupAbort = null;

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
 * @param {string} dataDir
 * @param {string} label
 */
function openChildLogFd(dataDir, label) {
  const logPath = path.join(dataDir, "logs", `${label}.log`);
  let fd = childLogFdByLabel.get(label);
  if (fd == null) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fd = fs.openSync(logPath, "a");
    childLogFdByLabel.set(label, fd);
    desktopLog(`${label} log: ${logPath}`);
  }
  fs.writeSync(fd, `\n--- ${new Date().toISOString()} starting ${label} ---\n`);
  return { logPath, fd };
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

  if (paths.isPackaged || entry.endsWith(".js")) {
    const { fd } = openChildLogFd(paths.dataDir, label);
    const nodeBin = paths.nodeBin;
    if (nodeBin && fs.existsSync(nodeBin)) {
      desktopLog(`spawn ${label} via nodeBin=${nodeBin}`);
      return spawn(nodeBin, [...nodeArgs, entry], {
        cwd,
        env,
        stdio: ["ignore", fd, fd],
        windowsHide: true,
        shell: false,
      });
    }
    // Fallback: Electron as Node (dev packs / missing bundled node).
    desktopLog(`spawn ${label} via ELECTRON_RUN_AS_NODE exec=${process.execPath}`);
    return spawn(process.execPath, [...nodeArgs, entry], {
      cwd,
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", fd, fd],
      windowsHide: true,
      shell: false,
    });
  }

  const tsxBin = resolveTsx(paths.repoRoot, paths.serverDir, paths.realmDir);
  const cmd = tsxBin === "npx" ? "npx" : tsxBin;
  const cmdArgs = tsxBin === "npx" ? ["tsx", entry] : [entry];
  return spawn(cmd, cmdArgs, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  });
}

/**
 * Send http(s) and osu: to the OS. Other schemes are ignored.
 * @param {string} url
 */
function openExternalSafe(url) {
  if (!canOpenExternal(url)) return;
  desktopLog(`openExternal (navigation) ${url}`);
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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Roxysu",
    show: true,
    backgroundColor: "#12141a",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  attachWindowGuards(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    desktopLog(`splash did-fail-load code=${code} desc=${desc} url=${url}`);
  });

  void mainWindow
    .loadFile(splashPath)
    .then(() => {
      desktopLog("splash loadFile ok");
      signalWindowReady(paths.dataDir);
    })
    .catch((err) => {
      desktopLog(`splash loadFile failed: ${err}`);
      signalWindowReady(paths.dataDir);
    });

  // Marker even if HTML fails — dark chrome is still a visible window for older stubs.
  signalWindowReady(paths.dataDir);
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
  realmSpawnedAt = Date.now();
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
    uptimeMs: Date.now() - realmSpawnedAt,
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

/**
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {string} urlArg Single `--url=…` token (host pre-splits argv on '=').
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
  const args = [urlArg, "--watchdog-max-age-sec=0"];
  if (output) args.push(`--output=${output}`);
  desktopLog(`spawn overlay bin=${bin} ${args.join(" ")}`);
  overlayAppliedUrlArg = urlArg;
  overlayAppliedOutput = output ?? null;
  // Do not set WEBKIT_DISABLE_DMABUF_RENDERER. On a transparent WebKitGTK
  // surface that fallback fills the whole window with grey on each HUD update.
  // Age cap is off: a 30-minute exit plus this respawn is a full HUD refresh
  // over the playfield. FD and RSS caps still exit 75 so a real leak recovers.
  overlayChild = spawn(bin, args, {
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    shell: false,
  });
  overlaySpawnedAt = Date.now();
  const child = overlayChild;
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      desktopLog(`overlay exited code=${code} signal=${signal}`);
    }
  });
  // Poll respawns off exitCode !== null. A second schedule would double-spawn.
  watchChildError(child, "overlay", () => {});
}

const OVERLAY_URL_DEFAULT = `--url=http://${HOST}:${PORT}/#/overlay?bg=clear`;
const OVERLAY_SETTINGS_POLL_MS = 4000;
const OVERLAY_RESPAWN_GAP_MS = 15000;

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

/**
 * Read the In-game overlay host settings from the client app settings store
 * (`overlay.enabled` + `overlay.hostUrl` + `overlay.output`). Resolves null when unreachable
 * (fetch failed — keep current state).
 */
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
          try {
            const overlay = JSON.parse(raw)?.overlay ?? {};
            const hostUrl =
              typeof overlay.hostUrl === "string" && overlay.hostUrl.trim()
                ? overlay.hostUrl.trim()
                : null;
            const output =
              typeof overlay.output === "string" && overlay.output.trim()
                ? overlay.output.trim()
                : null;
            resolve({ enabled: overlay.enabled !== false, hostUrl, output });
          } catch {
            resolve(null);
          }
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
  /** D2: one poll run in flight; a call mid-flight coalesces into one re-run. */
  const applyGate = createApplyGate();

  const apply = async () => {
    if (shuttingDown) return;
    if (!applyGate.begin()) return;
    try {
      const settings = await fetchOverlaySettings();
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
        spawnedAt: overlaySpawnedAt,
        now: Date.now(),
        respawnGapMs: OVERLAY_RESPAWN_GAP_MS,
        consecutiveFailures,
        lastKnownEnabled,
      });
      consecutiveFailures = decision.consecutiveFailures;
      lastKnownEnabled = decision.lastKnownEnabled;

      if (decision.action === "stop") {
        desktopLog(
          decision.reason === "disabled"
            ? "overlay disabled by setting — stopping host"
            : `overlay settings unreachable (${consecutiveFailures} polls) — stopping host`,
        );
      } else if (decision.action === "spawn") {
        if (decision.reason === "liveness-respawn") {
          desktopLog(
            `overlay liveness respawn (previous exit code=${overlayChild?.exitCode})`,
          );
        } else if (decision.reason === "url-changed") {
          desktopLog("overlay url changed — restarting host");
        } else if (decision.reason === "output-changed") {
          desktopLog("overlay monitor changed — restarting host");
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
          // Host pre-splits argv on '=', so the URL rides in one --url=… token
          // (decision.urlArg) and the monitor in one --output=… token.
          overlayChild = null;
          spawnOverlayHost(paths, urlArg, output);
        },
      });
      if (decision.action === "stop") {
        overlayChild = null;
        overlayAppliedUrlArg = null;
        overlayAppliedOutput = null;
      }
    } finally {
      if (applyGate.end() && !shuttingDown) {
        void apply();
      }
    }
  };

  void apply();
  overlayPollTimer = setInterval(() => void apply(), OVERLAY_SETTINGS_POLL_MS);
  overlayPollTimer.unref();
}

/**
 * @param {string} text
 * @param {{ animateDots?: boolean }} [opts]
 */
async function setSplashStatus(text, opts = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const animateDots = opts.animateDots !== false;
  const safe = JSON.stringify(text);
  try {
    await mainWindow.webContents.executeJavaScript(
      `(() => {
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
  desktopLog(`loadURL ${url}`);
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
  desktopLog(`openExternal ${parsed.origin}${parsed.pathname}`);
  await shell.openExternal(parsed.toString());
});

ipcMain.handle("roxysu:write-clipboard-image", async (event, bytes) => {
  if (!ipcSenderIsApp(event)) {
    throw new Error("Invalid sender");
  }
  if (bytes == null) {
    throw new Error("Invalid image");
  }
  const buf = Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes));
  if (buf.length === 0 || buf.length > MAX_CLIPBOARD_IMAGE_BYTES) {
    throw new Error("Invalid image");
  }
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
      app.exit(1);
      return;
    }

    desktopLog(`dataDir=${paths.dataDir}`);
    desktopLog(`dbPath=${paths.dbPath}`);
    desktopLog(`staticDir=${paths.staticDir}`);
    desktopLog(`nodeBin=${paths.nodeBin || "(none)"}`);
    desktopLog(`realmArchive=${paths.realmArchive || "(none)"}`);

    Menu.setApplicationMenu(null);

    createSplashWindow(paths);
    void setSplashStatus("Starting");

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

    desktopLog("spawn server");
    serverChild = spawnNodeEntry(
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

    void setSplashStatus("Waiting for server");
    desktopLog("waitForServer start");
    startupAbort = new AbortController();

    try {
      await waitForServer(PORT, HOST, 180_000, { signal: startupAbort.signal });
    } catch (err) {
      if (shuttingDown) return;
      desktopLog(`waitForServer failed: ${err}`);
      desktopLog(`see logs under ${path.join(paths.dataDir, "logs")}`);
      await setSplashStatus("Failed to start — see logs", { animateDots: false });
      await shutdown();
      app.exit(1);
      return;
    }
    if (shuttingDown) return;

    desktopLog("waitForServer ok");
    await setSplashStatus("Opening Home");
    try {
      await maybeClearHttpCache(paths);
      await loadAppIntoWindow();
    } catch (err) {
      if (shuttingDown) return;
      desktopLog(`loadAppIntoWindow failed: ${err}`);
      await setSplashStatus("Failed to open Home — see logs", { animateDots: false });
      await shutdown();
      app.exit(1);
      return;
    }
    if (shuttingDown) return;
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
    startAutoUpdate({ log: desktopLog });

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
