"use strict";

/**
 * Pure respawn policy for the realm-reader child (F-037). No Electron or
 * child_process imports so it can be unit-tested with plain `bun test`.
 *
 * Model: every unexpected exit is a "failure" unless the child stayed up for
 * at least `stableUptimeMs`, which resets the consecutive-failure counter.
 * Delay grows exponentially with the counter; after `maxAttempts` consecutive
 * short-lived runs the policy gives up so a binary that dies at boot cannot
 * spin forever.
 */

const DEFAULT_RESPAWN_CONFIG = Object.freeze({
  /** Delay before the first respawn. */
  baseDelayMs: 2000,
  /** Upper bound for the exponential delay. */
  maxDelayMs: 60000,
  /** Consecutive short-lived runs allowed before giving up. */
  maxAttempts: 6,
  /** A run at least this long resets the consecutive-failure counter. */
  stableUptimeMs: 60000,
});

/**
 * @param {{ failures: number, uptimeMs: number }} state
 *   `failures` = consecutive short-lived runs before this exit.
 * @param {Partial<typeof DEFAULT_RESPAWN_CONFIG>} [overrides]
 * @returns {{ action: "respawn", delayMs: number, failures: number }
 *   | { action: "give-up", failures: number }}
 */
function decideRespawn(state, overrides) {
  const cfg = { ...DEFAULT_RESPAWN_CONFIG, ...overrides };
  const uptimeMs = Number.isFinite(state.uptimeMs) ? state.uptimeMs : 0;
  const previous = Math.max(0, Math.floor(state.failures || 0));
  const failures = (uptimeMs >= cfg.stableUptimeMs ? 0 : previous) + 1;
  if (failures > cfg.maxAttempts) return { action: "give-up", failures };
  const delayMs = Math.min(
    cfg.maxDelayMs,
    cfg.baseDelayMs * 2 ** (failures - 1),
  );
  return { action: "respawn", delayMs, failures };
}

module.exports = { DEFAULT_RESPAWN_CONFIG, decideRespawn };
