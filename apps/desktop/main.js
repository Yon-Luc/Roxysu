const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const { resolveDesktopPaths, ensureParentDir, ensureRealmExtracted } = require("./paths");
const { startAutoUpdate } = require("./auto-update");

// Stable userData folder: %APPDATA%\Roxysu (Windows) / XDG or Application Support.
app.setName("Roxysu");

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import("node:child_process").ChildProcess | null} */
let serverChild = null;
/** @type {import("node:child_process").ChildProcess | null} */
let realmChild = null;
/** @type {number[]} */
const childLogFds = [];
let shuttingDown = false;
/** @type {string | null} */
let desktopLogPath = null;
const processStartedAt = Date.now();

const PORT = Number(process.env.ROXYSU_PORT ?? 4321);
const HOST = process.env.ROXYSU_HOST ?? "127.0.0.1";
const WINDOW_READY_MARKER = "electron-window-ready";

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
  const logDir = path.join(dataDir, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${label}.log`);
  const fd = fs.openSync(logPath, "a");
  fs.writeSync(fd, `\n--- ${new Date().toISOString()} starting ${label} ---\n`);
  childLogFds.push(fd);
  desktopLog(`${label} log: ${logPath}`);
  return { logPath, fd };
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
 */
function spawnNodeEntry(paths, entry, cwd, extraEnv, label) {
  const env = { ...process.env, ...extraEnv };

  if (paths.isPackaged || entry.endsWith(".js")) {
    const { fd } = openChildLogFd(paths.dataDir, label);
    const nodeBin = paths.nodeBin;
    if (nodeBin && fs.existsSync(nodeBin)) {
      desktopLog(`spawn ${label} via nodeBin=${nodeBin}`);
      return spawn(nodeBin, [entry], {
        cwd,
        env,
        stdio: ["ignore", fd, fd],
        windowsHide: true,
        shell: false,
      });
    }
    // Fallback: Electron as Node (dev packs / missing bundled node).
    desktopLog(`spawn ${label} via ELECTRON_RUN_AS_NODE exec=${process.execPath}`);
    return spawn(process.execPath, [entry], {
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
 * @param {number} port
 * @param {string} host
 * @param {number} timeoutMs
 */
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
        reject(
          new Error(
            `Timed out waiting for Roxysu at http://${host}:${port}${healthPath}`,
          ),
        );
        return;
      }
      setTimeout(tryOnce, 250);
    };

    tryOnce();
  });
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

/**
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {NodeJS.ProcessEnv} sharedEnv
 */
function spawnRealmReader(paths, sharedEnv) {
  if (realmChild && !realmChild.killed) return;
  try {
    ensureRealmExtracted(paths);
  } catch (err) {
    desktopLog(`realm extract failed: ${err}`);
    return;
  }
  if (!fs.existsSync(paths.realmEntry)) {
    desktopLog(`realm entry missing: ${paths.realmEntry}`);
    return;
  }
  desktopLog(`spawn realm-reader dir=${paths.realmDir}`);
  realmChild = spawnNodeEntry(
    paths,
    paths.realmEntry,
    paths.realmDir,
    sharedEnv,
    "realm-reader",
  );
  realmChild.on("exit", (code, signal) => {
    if (!shuttingDown) {
      desktopLog(`realm-reader exited code=${code} signal=${signal}`);
    }
  });
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

/**
 * @param {import("node:child_process").ChildProcess | null} child
 * @param {string} label
 */
function stopChild(child, label) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch (err) {
    desktopLog(`failed to stop ${label}: ${err}`);
  }
}

function closeChildLogs() {
  while (childLogFds.length > 0) {
    const fd = childLogFds.pop();
    try {
      fs.closeSync(fd);
    } catch {
      // already closed
    }
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChild(realmChild, "realm-reader");
  stopChild(serverChild, "server");
  realmChild = null;
  serverChild = null;
  closeChildLogs();
}

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

    const sharedEnv = {
      ROXYSU_DESKTOP: "1",
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
      sharedEnv,
      "server",
    );
    serverChild.on("exit", (code, signal) => {
      if (!shuttingDown) {
        desktopLog(`server exited code=${code} signal=${signal}`);
        void shutdown().then(() => app.exit(code ?? 1));
      }
    });

    void setSplashStatus("Waiting for server");
    desktopLog("waitForServer start");

    try {
      await waitForServer(PORT, HOST);
    } catch (err) {
      desktopLog(`waitForServer failed: ${err}`);
      desktopLog(`see logs under ${path.join(paths.dataDir, "logs")}`);
      await setSplashStatus("Failed to start — see logs", { animateDots: false });
      await shutdown();
      app.exit(1);
      return;
    }

    desktopLog("waitForServer ok");
    await setSplashStatus("Loading");
    await maybeClearHttpCache(paths);
    await loadAppIntoWindow();
    desktopLog("ready");

    // Defer Realm until the UI is up; extract archive lazily (shrink AV scan at install).
    spawnRealmReader(paths, sharedEnv);

    // NSIS installs only — check after UI is up so startup is not blocked.
    startAutoUpdate({ log: desktopLog });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void (async () => {
          createSplashWindow(paths);
          await loadAppIntoWindow();
        })();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    void shutdown();
  });
}
