"use strict";

/**
 * Pure respawn policy for the realm-reader and server children (F-037,
 * D-NEW-2). No Electron or child_process imports so it can be unit-tested
 * with plain `bun test`.
 *
 * Model: every unexpected exit is a "failure" unless the child stayed up for
 * at least `stableUptimeMs`, which resets the consecutive-failure counter.
 * Delay grows exponentially with the counter; after `maxAttempts` consecutive
 * short-lived runs the policy gives up so a binary that dies at boot cannot
 * spin forever.
 *
 * A process that stays alive but never becomes usable (the server child
 * before `/api/system/healthz` passes) must NOT look stable: the caller
 * passes `healthyAt` (the time health was first observed, or null) instead of
 * raw uptime, so a silent-but-running child still counts as short-lived.
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
 * Health-aware run uptime (D-NEW-2).
 *
 * `healthyAt` — timestamp at which the child was last observed healthy.
 * Supplying the property at all wins over `uptimeMs` (even as `null`, which
 * means "never healthy" and yields 0): the run is only as long as it has been
 * *healthy*, so a child that stays alive for minutes without passing its
 * health probe reports 0 and keeps incrementing the failure counter.
 *
 * @param {{ uptimeMs?: number, healthyAt?: number | null, now?: number }} state
 * @returns {number} Non-negative uptime in milliseconds.
 */
function resolveRespawnUptimeMs(state) {
  if ("healthyAt" in state) {
    if (state.healthyAt == null || !Number.isFinite(state.healthyAt)) return 0;
    const now = Number.isFinite(state.now) ? state.now : Date.now();
    return Math.max(0, now - state.healthyAt);
  }
  return Number.isFinite(state.uptimeMs) ? state.uptimeMs : 0;
}

/**
 * @param {{ failures: number, uptimeMs?: number, healthyAt?: number | null, now?: number }} state
 *   `failures` = consecutive short-lived runs before this exit.
 *   `healthyAt` (optional) = last time the child was healthy, null if never.
 * @param {Partial<typeof DEFAULT_RESPAWN_CONFIG>} [overrides]
 * @returns {{ action: "respawn", delayMs: number, failures: number }
 *   | { action: "give-up", failures: number }}
 */
function decideRespawn(state, overrides) {
  const cfg = { ...DEFAULT_RESPAWN_CONFIG, ...overrides };
  const uptimeMs = resolveRespawnUptimeMs(state);
  const previous = Math.max(0, Math.floor(state.failures || 0));
  const failures = (uptimeMs >= cfg.stableUptimeMs ? 0 : previous) + 1;
  if (failures > cfg.maxAttempts) return { action: "give-up", failures };
  const delayMs = Math.min(
    cfg.maxDelayMs,
    cfg.baseDelayMs * 2 ** (failures - 1),
  );
  return { action: "respawn", delayMs, failures };
}

module.exports = { DEFAULT_RESPAWN_CONFIG, decideRespawn, resolveRespawnUptimeMs };
