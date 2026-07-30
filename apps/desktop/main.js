const { app, BrowserWindow, Menu } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs");
const { resolveDesktopPaths, ensureParentDir } = require("./paths");

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

const PORT = Number(process.env.ROXYSU_PORT ?? 4321);
const HOST = process.env.ROXYSU_HOST ?? "127.0.0.1";

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
 * Append-only log under userData so packaged GUI launches are debuggable.
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
  console.log(`[roxysu-desktop] ${label} log: ${logPath}`);
  return { logPath, fd };
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

  // Packaged (and any .js entry): run Electron as Node. Never use shell — on
  // Windows shell:true opens blank cmd windows and can break ELECTRON_RUN_AS_NODE.
  if (paths.isPackaged || entry.endsWith(".js")) {
    const { fd } = openChildLogFd(paths.dataDir, label);
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

  // Dev: tsx on TypeScript entrypoints. Windows .bin shims are .cmd and need shell.
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
function waitForServer(port, host, timeoutMs = 60_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host, port, path: "/api/system/status", timeout: 1500 }, (res) => {
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
        reject(new Error(`Timed out waiting for Roxysu at http://${host}:${port}`));
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
    const { session } = require("electron");
    await session.defaultSession.clearCache();
    fs.writeFileSync(markerPath, token, "utf8");
    console.log(`[roxysu-desktop] cleared HTTP cache (${token})`);
  } catch (err) {
    console.error("[roxysu-desktop] clearCache failed", err);
  }
}

/**
 * Show a local splash immediately so startup wait for the API isn't a blank desktop.
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 */
async function createSplashWindow(paths) {
  await maybeClearHttpCache(paths);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Roxysu",
    show: false,
    backgroundColor: "#12141a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadFile(path.join(__dirname, "splash.html"));
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

/**
 * Navigate the existing window from splash → app once the local server is up.
 */
async function loadAppIntoWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("Main window missing when loading app");
  }
  await mainWindow.loadURL(`http://${HOST}:${PORT}/`);
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
    console.error(`[roxysu-desktop] failed to stop ${label}`, err);
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const paths = resolveDesktopPaths(app);
    ensureParentDir(paths.dbPath);
    fs.mkdirSync(path.join(paths.dataDir, "backups"), { recursive: true });

    if (!fs.existsSync(path.join(paths.staticDir, "index.html"))) {
      console.error(
        `[roxysu-desktop] missing UI build at ${paths.staticDir}` +
          (paths.isPackaged
            ? ""
            : " — run: bun run --cwd apps/server build:ui"),
      );
      app.exit(1);
      return;
    }

    console.log(`[roxysu-desktop] dataDir=${paths.dataDir}`);
    console.log(`[roxysu-desktop] dbPath=${paths.dbPath}`);
    console.log(`[roxysu-desktop] staticDir=${paths.staticDir}`);

    // Drop the default File/Edit/View/Window menu bar (Windows/Linux).
    Menu.setApplicationMenu(null);

    // Window first so the user sees a spinner while Node children boot.
    await createSplashWindow(paths);
    await setSplashStatus("Starting");

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
    };

    serverChild = spawnNodeEntry(
      paths,
      paths.serverEntry,
      paths.serverDir,
      sharedEnv,
      "server",
    );
    serverChild.on("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error(`[roxysu-desktop] server exited code=${code} signal=${signal}`);
        void shutdown().then(() => app.exit(code ?? 1));
      }
    });

    realmChild = spawnNodeEntry(
      paths,
      paths.realmEntry,
      paths.realmDir,
      sharedEnv,
      "realm-reader",
    );
    realmChild.on("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error(
          `[roxysu-desktop] realm-reader exited code=${code} signal=${signal}`,
        );
      }
    });

    await setSplashStatus("Waiting for server");

    try {
      await waitForServer(PORT, HOST);
    } catch (err) {
      console.error("[roxysu-desktop]", err);
      console.error(
        `[roxysu-desktop] see logs under ${path.join(paths.dataDir, "logs")}`,
      );
      await setSplashStatus("Failed to start — see logs", { animateDots: false });
      await shutdown();
      app.exit(1);
      return;
    }

    await setSplashStatus("Loading");
    await loadAppIntoWindow();
    console.log("[roxysu-desktop] ready");

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void (async () => {
          await createSplashWindow(paths);
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
