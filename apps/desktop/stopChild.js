"use strict";

/**
 * Stop a spawned child without hanging Quit. `kill()` returns false (and does
 * not emit `exit` again) when the pid is already gone, and a child in
 * uninterruptible sleep may ignore SIGKILL. Either case must still resolve.
 */

/** How long a child gets to exit after SIGTERM before it is SIGKILLed. */
const CHILD_STOP_GRACE_MS = 5000;
/** After SIGKILL, give up even if `exit` never arrives. */
const CHILD_STOP_KILL_DEADLINE_MS = 2000;

/**
 * @param {import("node:child_process").ChildProcess | { exitCode: number | null, signalCode: string | null, kill: (signal?: string) => boolean, once: Function } | null} child
 * @param {string} label
 * @param {{ graceMs?: number, killDeadlineMs?: number, log?: (message: string) => void }} [options]
 * @returns {Promise<void>}
 */
function stopChild(child, label, options = {}) {
  const graceMs = options.graceMs ?? CHILD_STOP_GRACE_MS;
  const killDeadlineMs = options.killDeadlineMs ?? CHILD_STOP_KILL_DEADLINE_MS;
  const log = options.log ?? (() => {});

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
      log(`${label} ignored SIGTERM for ${graceMs}ms — SIGKILL`);
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
