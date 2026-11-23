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
 * @property {{ enabled: boolean, hostUrl: string | null, output?: string | null, restartAt?: number | null } | null} settings
 *   Null when the settings poll failed (HTTP error, non-200, or a document
 *   without a valid `overlay` object).
 * @property {string} defaultUrlArg `--url=…` token used when hostUrl is null.
 * @property {boolean} hasChild A host child object exists.
 * @property {boolean} childExited The child object exists and has exited.
 * @property {string | null} appliedUrlArg Token the child was last spawned with.
 * @property {string | null} [appliedOutput] Monitor override the child was last spawned with.
 * @property {number | null} [appliedRestartAt] Restart nonce the child was last spawned under.
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
 * @property {string | null} [output] For `spawn`: monitor override, or null to follow the window.
 * @property {number | null} [restartAt] For `spawn`: restart nonce to record as applied.
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
  const output =
    typeof input.settings.output === "string" && input.settings.output.trim()
      ? input.settings.output.trim()
      : null;
  const restartAt =
    typeof input.settings.restartAt === "number" &&
    Number.isFinite(input.settings.restartAt)
      ? input.settings.restartAt
      : null;
  // D-NEW-1: a restart nonce from the settings UI is an explicit user edit.
  // It restarts immediately (bypasses the F-038 gap) and outranks "up to
  // date", so a visually dead host can be replaced with one click.
  const restartRequested =
    restartAt !== null && restartAt !== (input.appliedRestartAt ?? null);
  const urlUnchanged = urlArg === input.appliedUrlArg;
  const outputUnchanged = output === (input.appliedOutput ?? null);
  const unchanged = urlUnchanged && outputUnchanged;
  const changeReason = !urlUnchanged ? "url-changed" : "output-changed";

  if (input.hasChild && !input.childExited) {
    if (restartRequested) {
      return {
        ...base,
        action: "spawn",
        reason: "restart-requested",
        stopRunning: true,
        urlArg,
        output,
        restartAt,
      };
    }
    if (unchanged) return { ...base, action: "noop", reason: "up-to-date" };
    return {
      ...base,
      action: "spawn",
      reason: changeReason,
      stopRunning: true,
      urlArg,
      output,
      restartAt,
    };
  }

  if (input.hasChild && input.childExited) {
    // F-038: the crash-loop gap only rate-limits a plain liveness respawn. A
    // changed URL or monitor is an explicit user edit and applies immediately,
    // and so is a restart request.
    if (!restartRequested && unchanged && input.now - input.spawnedAt < input.respawnGapMs) {
      return { ...base, action: "noop", reason: "respawn-gap" };
    }
    return {
      ...base,
      action: "spawn",
      reason: restartRequested
        ? "restart-requested"
        : unchanged
          ? "liveness-respawn"
          : changeReason,
      stopRunning: false,
      urlArg,
      output,
      restartAt,
    };
  }

  return {
    ...base,
    action: "spawn",
    reason: "initial",
    stopRunning: false,
    urlArg,
    output,
    restartAt,
  };
}

module.exports = { OVERLAY_MAX_POLL_FAILURES, childIsAlive, decideOverlayApply };
