"use strict";

/**
 * Stop a spawned child without hanging Quit. `kill()` returns false (and does
 * not emit `exit` again) when the pid is already gone, and a child in
 * uninterruptible sleep may ignore SIGKILL. Either case must still resolve.
 *
 * DD-4: the polite stop is closing the child's stdin (the parent lifeline from
 * DD-1: server, realm-reader and overlay shut down gracefully on stdin EOF).
 * On POSIX SIGTERM is sent too. On Windows Node's SIGTERM is TerminateProcess
 * (a hard kill), so it is skipped there and only the grace-period kill
 * remains as the backstop.
 */

/** How long a child gets to exit after SIGTERM before it is SIGKILLed. */
const CHILD_STOP_GRACE_MS = 5000;
/** After SIGKILL, give up even if `exit` never arrives. */
const CHILD_STOP_KILL_DEADLINE_MS = 2000;

/**
 * @param {import("node:child_process").ChildProcess | { exitCode: number | null, signalCode: string | null, kill: (signal?: string) => boolean, once: Function } | null} child
 * @param {string} label
 * @param {{ graceMs?: number, killDeadlineMs?: number, log?: (message: string) => void, platform?: NodeJS.Platform }} [options]
 * @returns {Promise<void>}
 */
function stopChild(child, label, options = {}) {
  const graceMs = options.graceMs ?? CHILD_STOP_GRACE_MS;
  const killDeadlineMs = options.killDeadlineMs ?? CHILD_STOP_KILL_DEADLINE_MS;
  const log = options.log ?? (() => {});
  const platform = options.platform ?? process.platform;

  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    /** @type {NodeJS.Timeout | undefined} */
    let killTimer;
    /** @type {NodeJS.Timeout | undefined} */
    let hardTimer;

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      clearTimeout(hardTimer);
      resolve();
    };

    killTimer = setTimeout(() => {
      log(
        platform === "win32"
          ? `${label} still running ${graceMs}ms after stdin close — killing`
          : `${label} ignored SIGTERM for ${graceMs}ms — SIGKILL`,
      );
      try {
        if (!child.kill("SIGKILL")) {
          done();
          return;
        }
      } catch (err) {
        log(`failed to SIGKILL ${label}: ${err}`);
        done();
        return;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        done();
        return;
      }
      hardTimer = setTimeout(() => {
        log(`${label} still alive ${killDeadlineMs}ms after SIGKILL — continuing shutdown`);
        done();
      }, killDeadlineMs);
    }, graceMs);

    child.once("exit", done);

    // DD-4: ask first through the lifeline pipe.
    try {
      /** @type {{ stdin?: { end?: () => void, destroyed?: boolean } | null }} */ (child).stdin?.end?.();
    } catch (err) {
      log(`failed to close ${label} stdin: ${err}`);
    }
    if (platform === "win32") return;

    try {
      if (!child.kill("SIGTERM")) done();
    } catch (err) {
      log(`failed to stop ${label}: ${err}`);
      done();
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) done();
  });
}

module.exports = {
  CHILD_STOP_GRACE_MS,
  CHILD_STOP_KILL_DEADLINE_MS,
  stopChild,
};
