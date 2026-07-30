const { app, BrowserWindow } = require("electron");
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
 * @param {ReturnType<typeof resolveDesktopPaths>} paths
 * @param {string} entry
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} extraEnv
 */
function spawnNodeEntry(paths, entry, cwd, extraEnv) {
  const env = { ...process.env, ...extraEnv };
  if (paths.isPackaged || entry.endsWith(".js")) {
    return spawn(process.execPath, [entry], {
      cwd,
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }

  const tsxBin = resolveTsx(paths.repoRoot, paths.serverDir, paths.realmDir);
  const cmd = tsxBin === "npx" ? "npx" : tsxBin;
  const cmdArgs = tsxBin === "npx" ? ["tsx", entry] : [entry];
  return spawn(cmd, cmdArgs, {
    cwd,
    env,
    stdio: "inherit",
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Roxysu",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void mainWindow.loadURL(`http://${HOST}:${PORT}/`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChild(realmChild, "realm-reader");
  stopChild(serverChild, "server");
  realmChild = null;
  serverChild = null;
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
    );
    realmChild.on("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error(
          `[roxysu-desktop] realm-reader exited code=${code} signal=${signal}`,
        );
      }
    });

    try {
      await waitForServer(PORT, HOST);
    } catch (err) {
      console.error("[roxysu-desktop]", err);
      await shutdown();
      app.exit(1);
      return;
    }

    createWindow();
    console.log("[roxysu-desktop] ready");

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    void shutdown();
  });
}
