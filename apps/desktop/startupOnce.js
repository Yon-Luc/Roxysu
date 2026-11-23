"use strict";

/**
 * Runs its function at most once. Later calls return false and do not call fn.
 * @returns {{ run: (fn: () => void) => boolean, used: () => boolean }}
 */
function createOnceGuard() {
  let used = false;
  return {
    run(fn) {
      if (used) return false;
      used = true;
      fn();
      return true;
    },
    used() {
      return used;
    },
  };
}

/**
 * One in-flight startup. Callers that arrive while `fn` is running share its
 * promise (so they must not also reload). After it settles, later calls
 * return false and do not call `fn`.
 * @returns {{ start: (fn: () => Promise<boolean>) => Promise<boolean>, settled: () => boolean }}
 */
function createStartupJoin() {
  /** @type {Promise<boolean> | null} */
  let inflight = null;
  let settled = false;
  return {
    start(fn) {
      if (settled) return Promise.resolve(false);
      if (inflight) return inflight;
      // Call fn now, not on a later tick, so a second start in the same turn
      // joins this promise instead of starting another startup.
      try {
        inflight = Promise.resolve(fn()).then(
          (value) => {
            settled = true;
            return value !== false;
          },
          (err) => {
            settled = true;
            throw err;
          },
        );
      } catch (err) {
        settled = true;
        return Promise.reject(err);
      }
      return inflight;
    },
    settled() {
      return settled;
    },
  };
}

module.exports = { createOnceGuard, createStartupJoin };
