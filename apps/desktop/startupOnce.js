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

module.exports = { createOnceGuard };
