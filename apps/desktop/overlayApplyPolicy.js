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
 * DD-10: liveness respawns in a row (each child dying before
 * OVERLAY_STABLE_UPTIME_MS) before the shell parks the host until the user
 * changes something (toggle, URL, monitor, restart button).
 */
const OVERLAY_MAX_RESPAWNS = 5;
/** A child that ran at least this long resets the respawn backoff. */
const OVERLAY_STABLE_UPTIME_MS = 60_000;
/** Upper bound of the doubling respawn gap. */
const OVERLAY_MAX_RESPAWN_GAP_MS = 5 * 60_000;
/**
 * Exit status of an overlay host that cannot run in this session (no
 * Wayland, compositor without wlr-layer-shell such as GNOME). Matches
 * UNSUPPORTED_EXIT_CODE in apps/overlay-rs/src/lifecycle.rs. Never respawned.
 */
const OVERLAY_EXIT_UNSUPPORTED = 78;

const OVERLAY_SETTINGS_POLL_MS = 4000;
const OVERLAY_SETTINGS_POLL_DISABLED_MS = 10_000;
/** 10s while the host is known disabled; 4s otherwise (unknown or enabled). */
function overlaySettingsPollMs(enabled) {
  return enabled === false
    ? OVERLAY_SETTINGS_POLL_DISABLED_MS
    : OVERLAY_SETTINGS_POLL_MS;
}

/**
 * What to write to overlay-host-status.json after one apply decision.
 * A disable un-parks even when there is no child to stop (action "noop").
 * A failed poll does not clear a park.
 * @param {string | null} loggedParkReason
 * @param {{ action?: string, reason?: string }} decision
 * @returns {{ next: string | null, write: "unsupported" | "crash-loop" | "running" | null }}
 */
function overlayHostStatusWrite(loggedParkReason, decision) {
  const reason = decision?.reason;
  if (reason === "unsupported-session" || reason === "respawn-exhausted") {
    if (loggedParkReason === reason) return { next: loggedParkReason, write: null };
    return {
      next: reason,
      write: reason === "unsupported-session" ? "unsupported" : "crash-loop",
    };
  }
  // Only a user intent or a real spawn clears a park. A poll-failures
  // "stop" is not one: the exited host is still a child, and five missed
  // polls must not erase the Settings line.
  const unpark =
    loggedParkReason != null &&
    (reason === "disabled" ||
      reason === "restart-requested" ||
      reason === "url-changed" ||
      reason === "output-changed" ||
      reason === "initial" ||
      reason === "liveness-respawn" ||
      reason === "up-to-date");
  if (unpark) return { next: null, write: "running" };
  return { next: loggedParkReason ?? null, write: null };
}

/**
 * Gap before the next liveness respawn after `failures` quick deaths:
 * base, 2×, 4×, … capped at OVERLAY_MAX_RESPAWN_GAP_MS.
 * @param {number} baseGapMs
 * @param {number} failures
 */
function overlayRespawnGapMs(baseGapMs, failures) {
  const n = Math.max(0, Math.floor(failures || 0));
  return Math.min(baseGapMs * 2 ** Math.min(n, 20), OVERLAY_MAX_RESPAWN_GAP_MS);
}

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
 * @property {number} [respawnFailures] Quick liveness respawns in a row (DD-10).
 * @property {number | null} [childExitCode] Exit code of the exited child.
 * @property {number | null} [childUptimeMs] How long the exited child ran.
 * @property {number} [maxRespawns]
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
 * @property {number} respawnFailures Carry forward (DD-10).
 */

/**
 * @param {OverlayApplyInput} input
 * @returns {OverlayApplyDecision}
 */
function decideOverlayApply(input) {
  const maxFailures = input.maxPollFailures ?? OVERLAY_MAX_POLL_FAILURES;
  const respawnFailures = Math.max(0, Math.floor(input.respawnFailures ?? 0));

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
      respawnFailures,
    };
  }

  const { enabled, hostUrl } = input.settings;
  const base = { consecutiveFailures: 0, lastKnownEnabled: enabled, respawnFailures };

  if (!enabled) {
    // Turning the overlay off (and back on) clears a parked host (DD-10).
    return {
      ...base,
      respawnFailures: 0,
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
        respawnFailures: 0,
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
      respawnFailures: 0,
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
    // and so is a restart request. Both also clear the DD-10 backoff / park.
    if (restartRequested || !unchanged) {
      return {
        ...base,
        respawnFailures: 0,
        action: "spawn",
        reason: restartRequested ? "restart-requested" : changeReason,
        stopRunning: false,
        urlArg,
        output,
        restartAt,
      };
    }
    // DD-10: a host that ran long enough was healthy; start the backoff over.
    const failures =
      (input.childUptimeMs ?? 0) >= OVERLAY_STABLE_UPTIME_MS ? 0 : respawnFailures;
    if (input.childExitCode === OVERLAY_EXIT_UNSUPPORTED) {
      return { ...base, respawnFailures: failures, action: "noop", reason: "unsupported-session" };
    }
    if (failures >= (input.maxRespawns ?? OVERLAY_MAX_RESPAWNS)) {
      return { ...base, respawnFailures: failures, action: "noop", reason: "respawn-exhausted" };
    }
    if (input.now - input.spawnedAt < overlayRespawnGapMs(input.respawnGapMs, failures)) {
      return { ...base, respawnFailures: failures, action: "noop", reason: "respawn-gap" };
    }
    return {
      ...base,
      respawnFailures: failures + 1,
      action: "spawn",
      reason: "liveness-respawn",
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

module.exports = {
  OVERLAY_EXIT_UNSUPPORTED,
  OVERLAY_MAX_POLL_FAILURES,
  OVERLAY_MAX_RESPAWNS,
  OVERLAY_MAX_RESPAWN_GAP_MS,
  OVERLAY_SETTINGS_POLL_DISABLED_MS,
  OVERLAY_SETTINGS_POLL_MS,
  OVERLAY_STABLE_UPTIME_MS,
  childIsAlive,
  decideOverlayApply,
  overlayRespawnGapMs,
  overlayHostStatusWrite,
  overlaySettingsPollMs,
};
