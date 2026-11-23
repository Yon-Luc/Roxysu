"use strict";

/**
 * Pure helpers for keeping the app window usable when the server or the
 * renderer dies mid-session (DD-6, DD-7). No Electron imports.
 */

/** IPC channel main → renderer for server state (preload `onServerState`). */
const SERVER_STATE_CHANNEL = "roxysu:server-state";

/**
 * @typedef {{ state: "restarting", attempt: number, maxAttempts: number, delayMs: number } | { state: "up" }} ServerState
 */

/**
 * Banner payload for a scheduled server respawn.
 * @param {{ failures: number, delayMs: number }} decision From decideRespawn.
 * @param {number} maxAttempts
 * @returns {ServerState}
 */
function serverStateForRespawn(decision, maxAttempts) {
  return {
    state: "restarting",
    attempt: Math.max(1, Math.floor(decision.failures || 1)),
    maxAttempts,
    delayMs: Math.max(0, Math.round(decision.delayMs || 0)),
  };
}

/**
 * How to bring the app back after the server returns: reload in place when
 * the window is on the app (keeps the #/route), otherwise load the root.
 * @param {string} currentUrl
 * @param {string} appOrigin
 * @returns {"reload" | "load"}
 */
function reloadActionFor(currentUrl, appOrigin) {
  try {
    return new URL(currentUrl).origin === appOrigin ? "reload" : "load";
  } catch {
    return "load";
  }
}

/** Renderer crashes inside the window before the shell stops reloading. */
const RENDERER_MAX_CRASHES = 3;
/** A renderer that lived this long resets the crash counter. */
const RENDERER_STABLE_MS = 60_000;

/**
 * @param {{ reason: string, crashes: number, lastCrashAt: number, now: number, maxCrashes?: number, stableMs?: number }} input
 * @returns {{ action: "ignore" | "reload" | "fatal", crashes: number }}
 */
function decideRendererGone(input) {
  // "clean-exit" is a normal teardown (window closing, navigation swap).
  if (input.reason === "clean-exit") return { action: "ignore", crashes: input.crashes };
  const stableMs = input.stableMs ?? RENDERER_STABLE_MS;
  const previous = input.lastCrashAt && input.now - input.lastCrashAt >= stableMs ? 0 : input.crashes;
  const crashes = previous + 1;
  if (crashes > (input.maxCrashes ?? RENDERER_MAX_CRASHES)) return { action: "fatal", crashes };
  return { action: "reload", crashes };
}

module.exports = {
  RENDERER_MAX_CRASHES,
  RENDERER_STABLE_MS,
  SERVER_STATE_CHANNEL,
  decideRendererGone,
  reloadActionFor,
  serverStateForRespawn,
};
