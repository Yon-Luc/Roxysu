/**
 * NSIS-only Windows auto-update via electron-updater + GitHub Releases.
 * Skipped for portable builds, non-Windows, and unpackaged (dev) runs.
 */

const { app, dialog } = require("electron");

/**
 * @param {{ log: (message: string) => void }} opts
 */
function startAutoUpdate(opts) {
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
    const pct = typeof p?.percent === "number" ? p.percent.toFixed(1) : "?";
    log(`auto-update download-progress ${pct}%`);
  });
  autoUpdater.on("error", (err) => {
    log(`auto-update error: ${err}`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    log(`auto-update downloaded version=${info?.version ?? "?"}`);
    if (promptShown) return;
    promptShown = true;

    let result;
    try {
      result = await dialog.showMessageBox({
        type: "info",
        title: "Roxysu update",
        message: `Version ${info?.version ?? "a new release"} is ready.`,
        detail: "Restart now to install the update. Your data is kept in AppData.",
        buttons: ["Restart to update", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
    } catch (err) {
      log(`auto-update dialog failed: ${err}`);
      return;
    }

    if (result.response === 0) {
      log("auto-update quitAndInstall");
      // isSilent=false, isForceRunAfter=true (relaunch after NSIS finishes).
      autoUpdater.quitAndInstall(false, true);
    } else {
      log("auto-update deferred (will install on quit if autoInstallOnAppQuit)");
    }
  });

  log(`auto-update start current=${app.getVersion()}`);
  void autoUpdater.checkForUpdates().catch((err) => {
    log(`auto-update checkForUpdates failed: ${err}`);
  });
}

module.exports = { startAutoUpdate };
