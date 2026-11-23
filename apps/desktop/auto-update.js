/**
 * NSIS-only Windows auto-update via electron-updater + GitHub Releases.
 * Skipped for portable builds, non-Windows, and unpackaged (dev) runs.
 *
 * Electron is required inside startAutoUpdate so this file can be loaded
 * without Electron (the policy sibling is what tests import).
 */

const {
  UPDATE_RECHECK_MS,
  shouldLogDownloadProgress,
  installDownloadedUpdate,
} = require("./autoUpdatePolicy");

/**
 * @param {{
 *   log: (message: string) => void,
 *   beforeInstall?: () => Promise<void> | void,
 *   getDialogParent?: () => import("electron").BrowserWindow | null | undefined,
 *   setInterval?: (fn: () => void, ms: number) => { unref?: () => void } | number,
 * }} opts
 */
function startAutoUpdate(opts) {
  const { app, dialog, BrowserWindow } = require("electron");
  const log = opts.log;

  if (!app.isPackaged) {
    log("auto-update skip: not packaged");
    return;
  }
  if (process.platform !== "win32") {
    log("auto-update skip: not windows");
    return;
  }
  // electron-builder portable sets these; NSIS installs do not.
  if (process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR) {
    log("auto-update skip: portable build");
    return;
  }

  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    log(`auto-update skip: electron-updater load failed: ${err}`);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m) => log(`updater: ${m}`),
    warn: (m) => log(`updater warn: ${m}`),
    error: (m) => log(`updater error: ${m}`),
    debug: (m) => log(`updater debug: ${m}`),
  };

  let promptShown = false;
  let lastDownloadBucket = null;

  const dialogParent = () => {
    if (typeof opts.getDialogParent === "function") return opts.getDialogParent();
    return BrowserWindow.getFocusedWindow();
  };

  autoUpdater.on("checking-for-update", () => {
    log("auto-update checking-for-update");
  });
  autoUpdater.on("update-available", (info) => {
    log(`auto-update available version=${info?.version ?? "?"}`);
  });
  autoUpdater.on("update-not-available", (info) => {
    log(`auto-update not-available version=${info?.version ?? app.getVersion()}`);
  });
  autoUpdater.on("download-progress", (p) => {
    const decision = shouldLogDownloadProgress(lastDownloadBucket, p?.percent);
    lastDownloadBucket = decision.bucket;
    if (decision.log) {
      log(`auto-update download-progress ${decision.bucket}%`);
    }
  });
  autoUpdater.on("error", (err) => {
    log(`auto-update error: ${err}`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    log(`auto-update downloaded version=${info?.version ?? "?"}`);
    if (promptShown) return;
    promptShown = true;

    const box = {
      type: "info",
      title: "Roxysu update",
      message: `Version ${info?.version ?? "a new release"} is ready.`,
      detail: "Restart now to install the update. Your data is kept in AppData.",
      buttons: ["Restart to update", "Later"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };

    let result;
    try {
      const parent = dialogParent();
      result = parent
        ? await dialog.showMessageBox(parent, box)
        : await dialog.showMessageBox(box);
    } catch (err) {
      log(`auto-update dialog failed: ${err}`);
      return;
    }

    if (result.response === 0) {
      await installDownloadedUpdate({
        autoUpdater,
        beforeInstall: opts.beforeInstall,
        log,
      });
    } else {
      log("auto-update deferred (will install on quit if autoInstallOnAppQuit)");
    }
  });

  const checkForUpdates = () => {
    void autoUpdater.checkForUpdates().catch((err) => {
      log(`auto-update checkForUpdates failed: ${err}`);
    });
  };

  log(`auto-update start current=${app.getVersion()}`);
  checkForUpdates();

  // Recheck only after a real start. Skip paths return above and must not arm this.
  const schedule = opts.setInterval ?? setInterval;
  const handle = schedule(checkForUpdates, UPDATE_RECHECK_MS);
  if (handle != null && typeof handle.unref === "function") {
    handle.unref();
  }
}

module.exports = { startAutoUpdate };
