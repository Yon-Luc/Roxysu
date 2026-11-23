"use strict";

const fs = require("node:fs");

/**
 * Size-capped log rotation (L4). No Electron imports so it can be unit-tested
 * with plain `bun test`.
 *
 * Each capped log keeps exactly one backup (`<path>.1`), which is replaced on
 * every rotation, so a runaway log can never fill the user's disk: the live
 * file is bounded by `maxBytes` and so is the backup.
 *
 * Rotation is best-effort by design — a log file that cannot be inspected or
 * renamed (permissions, Windows sharing, a file removed under us) must never
 * break the caller, so nothing here throws.
 */

/** Default per-log cap: 10 MiB live + 10 MiB `.1` backup. */
const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024;

/**
 * @param {unknown} size File size in bytes (typically `fs.statSync().size`).
 * @param {number} maxBytes Cap; non-positive or non-finite disables rotation.
 * @returns {boolean} True when the file is strictly larger than the cap.
 */
function shouldRotate(size, maxBytes) {
  if (!Number.isFinite(size) || !Number.isFinite(maxBytes)) return false;
  if (maxBytes <= 0) return false;
  return size > maxBytes;
}

/**
 * Rotate `filePath` to `filePath.1` when it grew past `maxBytes`.
 *
 * The previous `.1` is removed first (Windows `renameSync` refuses to replace
 * an existing file). A missing live file is not an error — there is simply
 * nothing to rotate.
 *
 * @param {string} filePath
 * @param {number} [maxBytes]
 * @param {{
 *   stat?: (p: string) => { size: number },
 *   rename?: (from: string, to: string) => void,
 *   unlink?: (p: string) => void,
 *   onError?: (err: unknown) => void,
 * }} [options] Optional fs seams for tests; defaults are the real `node:fs`.
 * @returns {boolean} True when the file was rotated.
 */
function rotateIfLarger(filePath, maxBytes = DEFAULT_MAX_LOG_BYTES, options = {}) {
  if (typeof filePath !== "string" || filePath.length === 0) return false;
  const stat = options.stat ?? ((p) => fs.statSync(p));
  const rename = options.rename ?? ((from, to) => fs.renameSync(from, to));
  const unlink = options.unlink ?? ((p) => fs.unlinkSync(p));
  const onError = options.onError ?? (() => {});
  try {
    let size;
    try {
      size = stat(filePath).size;
    } catch {
      // Missing (never written yet) or unreadable — nothing to rotate.
      return false;
    }
    if (!shouldRotate(size, maxBytes)) return false;
    const backupPath = `${filePath}.1`;
    try {
      unlink(backupPath);
    } catch {
      // No previous backup — the rename below creates it.
    }
    rename(filePath, backupPath);
    return true;
  } catch (err) {
    onError(err);
    return false;
  }
}

/**
 * In-session cap for a log whose fd is shared with a running child (DD-5).
 *
 * The child keeps writing through the same open file description, so the file
 * cannot be renamed away (the child would follow it). Instead: copy the live
 * file to `<path>.1` (replacing the old backup) and truncate the shared fd to
 * zero. The fd was opened with "a" (O_APPEND), so the child's next write lands
 * at the new end of file instead of leaving a sparse hole.
 *
 * Lines written between the copy and the truncate are lost (milliseconds).
 * Never throws.
 *
 * @param {number} fd Append-mode fd shared with the child.
 * @param {string} filePath Path of the same file.
 * @param {number} [maxBytes]
 * @param {{
 *   fstat?: (fd: number) => { size: number },
 *   copyFile?: (from: string, to: string) => void,
 *   unlink?: (p: string) => void,
 *   ftruncate?: (fd: number, len: number) => void,
 *   onError?: (err: unknown) => void,
 * }} [options] fs seams for tests.
 * @returns {boolean} True when the log was rotated.
 */
function copyTruncateIfLarger(fd, filePath, maxBytes = DEFAULT_MAX_LOG_BYTES, options = {}) {
  const fstat = options.fstat ?? ((f) => fs.fstatSync(f));
  const copyFile = options.copyFile ?? ((from, to) => fs.copyFileSync(from, to));
  const unlink = options.unlink ?? ((p) => fs.unlinkSync(p));
  const ftruncate = options.ftruncate ?? ((f, len) => fs.ftruncateSync(f, len));
  const onError = options.onError ?? (() => {});
  try {
    if (!shouldRotate(fstat(fd).size, maxBytes)) return false;
    const backupPath = `${filePath}.1`;
    try {
      unlink(backupPath);
    } catch {
      // no previous backup
    }
    copyFile(filePath, backupPath);
    ftruncate(fd, 0);
    return true;
  } catch (err) {
    onError(err);
    return false;
  }
}

/**
 * Size of `filePath` in bytes, or 0 when it does not exist / cannot be read.
 * @param {string} filePath
 * @returns {number}
 */
function fileSizeOrZero(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

module.exports = {
  DEFAULT_MAX_LOG_BYTES,
  copyTruncateIfLarger,
  fileSizeOrZero,
  rotateIfLarger,
  shouldRotate,
};
