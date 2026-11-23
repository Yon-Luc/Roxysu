"use strict";

/**
 * Sequencing helpers for the In-game overlay host settings poll (D2).
 *
 * `watchOverlayHostSetting` in main.js polls settings every 4 s and restarts
 * the host child on change. Two hazards live here, not in the (pure, tested)
 * decision helper:
 *
 * 1. Overlapping runs — a slow settings fetch or a stop that waits for
 *    SIGKILL deadlines can outlive one poll interval, so two `apply()` runs
 *    race and both spawn a host. `createApplyGate` allows one run in flight;
 *    calls that arrive mid-flight coalesce into a single follow-up run, so a
 *    saved settings change applies as soon as the current run settles instead
 *    of waiting for the next tick.
 *
 * 2. Overlapping hosts — a spawn must not run until the previous child is
 *    fully stopped (SIGTERM, SIGKILL, deadline). Two layer-shell hosts alive
 *    at once, or a SIGKILL of a mapped DMA-BUF client, corrupt the playfield.
 *    `executeOverlayDecision` awaits the injected `stop` before calling the
 *    injected `spawn`.
 *
 * No Electron or child_process imports so it can be unit-tested with
 * `bun test`, like overlayApplyPolicy.js.
 */

/**
 * One poll run at a time; extra calls coalesce.
 *
 * `begin()` → true when the caller may run (gate was open); false when a run
 * is already in flight — the call is recorded as coalesced and must NOT run.
 * `end()` → true when a coalesced call must re-trigger the run once.
 *
 * @typedef {Object} ApplyGate
 * @property {() => boolean} begin
 * @property {() => boolean} end
 */

/**
 * @returns {ApplyGate}
 */
function createApplyGate() {
  let inFlight = false;
  let coalesced = false;
  return {
    begin() {
      if (inFlight) {
        coalesced = true;
        return false;
      }
      inFlight = true;
      return true;
    },
    end() {
      inFlight = false;
      const rerun = coalesced;
      coalesced = false;
      return rerun;
    },
  };
}

/**
 * Run one `decideOverlayApply` decision with strict stop→spawn ordering.
 * "noop" touches nothing. "stop" awaits `deps.stop()` so the caller can
 * clear its bookkeeping only once the child is really gone.
 *
 * @param {import("./overlayApplyPolicy").OverlayApplyDecision} decision
 * @param {{
 *   stop: () => Promise<void>,
 *   spawn: (urlArg: string, output: string | null) => void,
 * }} deps
 * @returns {Promise<void>}
 */
async function executeOverlayDecision(decision, deps) {
  if (decision.action === "stop") {
    await deps.stop();
    return;
  }
  if (decision.action === "spawn") {
    // A restart must never overlap the child it replaces.
    if (decision.stopRunning) await deps.stop();
    deps.spawn(decision.urlArg, decision.output ?? null);
  }
}

module.exports = { createApplyGate, executeOverlayDecision };
