"use strict";

/**
 * Pure decision helper for the In-game overlay host poll (F-038, F-066). No
 * Electron or child_process imports so it can be unit-tested with `bun test`.
 *
 * `decideOverlayApply` takes the latest poll result plus the shell's current
 * view of the child and returns what `apply()` in `main.js` should do and the
 * bookkeeping (failure counter, last known enabled flag) to carry forward.
 */

/** Consecutive failed settings polls before a live host is stopped. */
const OVERLAY_MAX_POLL_FAILURES = 5;

/**
 * A spawned child is alive only while both exit fields are still null.
 * Signal death sets `signalCode` and leaves `exitCode` null. `killed` is not
 * this check — an exited child is not `killed`.
 * @param {{ exitCode: number | null, signalCode: NodeJS.Signals | null } | null | undefined} child
 * @returns {boolean}
 */
function childIsAlive(child) {
  return child != null && child.exitCode === null && child.signalCode === null;
}

/**
 * @typedef {object} OverlayApplyInput
 * @property {{ enabled: boolean, hostUrl: string | null } | null} settings
 *   Null when the settings poll failed (HTTP error or timeout).
 * @property {string} defaultUrlArg `--url=…` token used when hostUrl is null.
 * @property {boolean} hasChild A host child object exists.
 * @property {boolean} childExited The child object exists and has exited.
 * @property {string | null} appliedUrlArg Token the child was last spawned with.
 * @property {number} spawnedAt Timestamp (ms) of the last spawn.
 * @property {number} now Timestamp (ms).
 * @property {number} respawnGapMs Liveness respawn rate limit.
 * @property {number} consecutiveFailures Failed polls in a row before this one.
 * @property {boolean | null} lastKnownEnabled Last successfully read toggle.
 * @property {number} [maxPollFailures]
 */

/**
 * @typedef {object} OverlayApplyDecision
 * @property {"noop" | "stop" | "spawn"} action
 * @property {string} [reason]
 * @property {boolean} [stopRunning] For `spawn`: SIGTERM the live child first.
 * @property {string} [urlArg] For `spawn`: the `--url=…` token to use.
 * @property {number} consecutiveFailures
 * @property {boolean | null} lastKnownEnabled
 */

/**
 * @param {OverlayApplyInput} input
 * @returns {OverlayApplyDecision}
 */
function decideOverlayApply(input) {
  const maxFailures = input.maxPollFailures ?? OVERLAY_MAX_POLL_FAILURES;

  if (!input.settings) {
    // A failed poll carries no new intent. One failure must not kill the HUD.
    // After the cap, stop whenever a child is alive. The last known toggle
    // cannot gate this: a disable already cleared the child, and a dead
    // server with the toggle still on must not keep drawing.
    const consecutiveFailures = input.consecutiveFailures + 1;
    const shouldStop =
      consecutiveFailures >= maxFailures && input.hasChild;
    return {
      action: shouldStop ? "stop" : "noop",
      reason: shouldStop ? "poll-failures" : "poll-failed",
      consecutiveFailures,
      lastKnownEnabled: input.lastKnownEnabled,
    };
  }

  const { enabled, hostUrl } = input.settings;
  const base = { consecutiveFailures: 0, lastKnownEnabled: enabled };

  if (!enabled) {
    return {
      ...base,
      action: input.hasChild ? "stop" : "noop",
      reason: "disabled",
    };
  }

  const urlArg = hostUrl === null ? input.defaultUrlArg : `--url=${hostUrl}`;
  const urlUnchanged = urlArg === input.appliedUrlArg;

  if (input.hasChild && !input.childExited) {
    if (urlUnchanged) return { ...base, action: "noop", reason: "up-to-date" };
    return {
      ...base,
      action: "spawn",
      reason: "url-changed",
      stopRunning: true,
      urlArg,
    };
  }

  if (input.hasChild && input.childExited) {
    // F-038: the crash-loop gap only rate-limits a plain liveness respawn. A
    // changed URL is an explicit user edit and applies immediately.
    if (urlUnchanged && input.now - input.spawnedAt < input.respawnGapMs) {
      return { ...base, action: "noop", reason: "respawn-gap" };
    }
    return {
      ...base,
      action: "spawn",
      reason: urlUnchanged ? "liveness-respawn" : "url-changed",
      stopRunning: false,
      urlArg,
    };
  }

  return {
    ...base,
    action: "spawn",
    reason: "initial",
    stopRunning: false,
    urlArg,
  };
}

module.exports = { OVERLAY_MAX_POLL_FAILURES, childIsAlive, decideOverlayApply };
