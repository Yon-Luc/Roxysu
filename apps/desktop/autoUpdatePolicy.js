"use strict";

/**
 * Pure auto-update decisions. No Electron imports, so `bun test` can load
 * this file without a packaged app.
 */

/** Recheck interval after the first checkForUpdates. */
const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * 10% download bucket, clamped to 0..100. Non-finite percents are ignored.
 * @param {unknown} percent
 * @returns {number | null}
 */
function downloadProgressBucket(percent) {
  if (typeof percent !== "number" || !Number.isFinite(percent)) return null;
  return Math.min(100, Math.max(0, Math.floor(percent / 10) * 10));
}

/**
 * Log once per new bucket. A non-finite percent does not log and does not
 * move the bucket.
 * @param {number | null | undefined} lastBucket
 * @param {unknown} percent
 * @returns {{ log: boolean, bucket: number | null }}
 */
function shouldLogDownloadProgress(lastBucket, percent) {
  const bucket = downloadProgressBucket(percent);
  if (bucket === null) {
    return { log: false, bucket: typeof lastBucket === "number" ? lastBucket : null };
  }
  return { log: bucket !== lastBucket, bucket };
}

/**
 * Await an optional pre-install hook, then quit-and-install. A throwing hook
 * is logged and does not install.
 * @param {{
 *   autoUpdater: { quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void },
 *   beforeInstall?: () => Promise<void> | void,
 *   log: (message: string) => void,
 * }} opts
 */
async function installDownloadedUpdate(opts) {
  const { autoUpdater, beforeInstall, log } = opts;
  if (typeof beforeInstall === "function") {
    try {
      await beforeInstall();
    } catch (err) {
      log(`auto-update beforeInstall failed: ${err}`);
      return;
    }
  }
  // Log only once the hook has succeeded, so a failure does not claim we installed.
  log("auto-update quitAndInstall");
  autoUpdater.quitAndInstall(true, true);
}

module.exports = {
  UPDATE_RECHECK_MS,
  downloadProgressBucket,
  shouldLogDownloadProgress,
  installDownloadedUpdate,
};
