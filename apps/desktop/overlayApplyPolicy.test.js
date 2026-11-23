import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OVERLAY_EXIT_UNSUPPORTED,
  OVERLAY_MAX_POLL_FAILURES,
  OVERLAY_MAX_RESPAWNS,
  OVERLAY_MAX_RESPAWN_GAP_MS,
  OVERLAY_STABLE_UPTIME_MS,
  childIsAlive,
  decideOverlayApply,
  overlayRespawnGapMs,
} = require("./overlayApplyPolicy.js");

const DEFAULT_ARG = "--url=http://127.0.0.1:3000/#/overlay?bg=clear";
const GAP = 15000;

function input(overrides = {}) {
  return {
    settings: { enabled: true, hostUrl: null },
    defaultUrlArg: DEFAULT_ARG,
    hasChild: false,
    childExited: false,
    appliedUrlArg: null,
    spawnedAt: 0,
    now: 1_000_000,
    respawnGapMs: GAP,
    consecutiveFailures: 0,
    lastKnownEnabled: null,
    ...overrides,
  };
}

describe("childIsAlive", () => {
  test("signal death is not alive", () => {
    expect(childIsAlive({ exitCode: null, signalCode: "SIGSEGV" })).toBe(false);
  });

  test("a running child is alive", () => {
    expect(childIsAlive({ exitCode: null, signalCode: null })).toBe(true);
  });

  test("a clean exit is not alive", () => {
    expect(childIsAlive({ exitCode: 0, signalCode: null })).toBe(false);
  });
});

describe("decideOverlayApply: spawn / liveness", () => {
  test("initial spawn with the default url", () => {
    const d = decideOverlayApply(input());
    expect(d).toMatchObject({ action: "spawn", reason: "initial", urlArg: DEFAULT_ARG });
    expect(d.stopRunning).toBe(false);
  });

  test("running child with unchanged url is a noop", () => {
    const d = decideOverlayApply(
      input({ hasChild: true, appliedUrlArg: DEFAULT_ARG }),
    );
    expect(d.action).toBe("noop");
  });

  test("exited child inside the gap with unchanged url waits", () => {
    const d = decideOverlayApply(
      input({
        hasChild: true,
        childExited: true,
        appliedUrlArg: DEFAULT_ARG,
        spawnedAt: 1_000_000 - 1000,
      }),
    );
    expect(d).toMatchObject({ action: "noop", reason: "respawn-gap" });
  });

  test("exited child past the gap with unchanged url respawns", () => {
    const d = decideOverlayApply(
      input({
        hasChild: true,
        childExited: true,
        appliedUrlArg: DEFAULT_ARG,
        spawnedAt: 1_000_000 - GAP,
      }),
    );
    expect(d).toMatchObject({ action: "spawn", reason: "liveness-respawn", stopRunning: false });
  });
});

describe("decideOverlayApply: F-038 url change bypasses the gap", () => {
  test("exited child inside the gap but url changed spawns immediately", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: "http://127.0.0.1:3000/#/overlay?profile=a" },
        hasChild: true,
        childExited: true,
        appliedUrlArg: DEFAULT_ARG,
        spawnedAt: 1_000_000 - 1000,
      }),
    );
    expect(d).toMatchObject({
      action: "spawn",
      reason: "url-changed",
      stopRunning: false,
      urlArg: "--url=http://127.0.0.1:3000/#/overlay?profile=a",
    });
  });

  test("running child with changed url stops the old one then spawns", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: "http://x/#/overlay" },
        hasChild: true,
        appliedUrlArg: DEFAULT_ARG,
      }),
    );
    expect(d).toMatchObject({ action: "spawn", reason: "url-changed", stopRunning: true });
  });
});

describe("decideOverlayApply: disabled", () => {
  test("disabled with a child stops it and records the toggle", () => {
    const d = decideOverlayApply(
      input({ settings: { enabled: false, hostUrl: null }, hasChild: true }),
    );
    expect(d).toMatchObject({
      action: "stop",
      reason: "disabled",
      lastKnownEnabled: false,
      consecutiveFailures: 0,
    });
  });

  test("disabled without a child is a noop", () => {
    const d = decideOverlayApply(
      input({ settings: { enabled: false, hostUrl: null } }),
    );
    expect(d).toMatchObject({ action: "noop", lastKnownEnabled: false });
  });

  test("disabled never respawns an exited child", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: false, hostUrl: null },
        hasChild: true,
        childExited: true,
      }),
    );
    expect(d.action).toBe("stop");
  });
});

describe("decideOverlayApply: F-066 poll failures", () => {
  test("a single failure keeps the host and counts", () => {
    const d = decideOverlayApply(
      input({ settings: null, hasChild: true, lastKnownEnabled: true }),
    );
    expect(d).toMatchObject({
      action: "noop",
      reason: "poll-failed",
      consecutiveFailures: 1,
      lastKnownEnabled: true,
    });
  });

  test("failures below the cap with a live host stay a noop", () => {
    const d = decideOverlayApply(
      input({
        settings: null,
        hasChild: true,
        lastKnownEnabled: true,
        consecutiveFailures: OVERLAY_MAX_POLL_FAILURES - 2,
      }),
    );
    expect(d).toMatchObject({
      action: "noop",
      reason: "poll-failed",
      consecutiveFailures: OVERLAY_MAX_POLL_FAILURES - 1,
    });
  });

  test("failures at the cap with a live host stop it", () => {
    const d = decideOverlayApply(
      input({
        settings: null,
        hasChild: true,
        lastKnownEnabled: true,
        consecutiveFailures: OVERLAY_MAX_POLL_FAILURES - 1,
      }),
    );
    expect(d).toMatchObject({
      action: "stop",
      reason: "poll-failures",
      consecutiveFailures: OVERLAY_MAX_POLL_FAILURES,
      lastKnownEnabled: true,
    });
  });

  test("a later successful enabled poll with no child spawns", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null },
        hasChild: false,
        lastKnownEnabled: true,
      }),
    );
    expect(d).toMatchObject({
      action: "spawn",
      reason: "initial",
      stopRunning: false,
      urlArg: DEFAULT_ARG,
    });
  });

  test("failures with no child never stop anything", () => {
    const d = decideOverlayApply(
      input({
        settings: null,
        hasChild: false,
        lastKnownEnabled: false,
        consecutiveFailures: 10,
      }),
    );
    expect(d.action).toBe("noop");
  });

  test("a changed monitor restarts a running host and bypasses the gap", () => {
    const running = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null, output: "DP-4" },
        hasChild: true,
        appliedUrlArg: DEFAULT_ARG,
        appliedOutput: null,
      }),
    );
    expect(running).toMatchObject({
      action: "spawn",
      reason: "output-changed",
      stopRunning: true,
      output: "DP-4",
      urlArg: DEFAULT_ARG,
    });

    const insideGap = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null, output: "DP-4" },
        hasChild: true,
        childExited: true,
        appliedUrlArg: DEFAULT_ARG,
        appliedOutput: null,
        spawnedAt: 1_000_000 - 1000,
      }),
    );
    expect(insideGap).toMatchObject({
      action: "spawn",
      reason: "output-changed",
      stopRunning: false,
      output: "DP-4",
    });
  });

  test("an unchanged monitor stays up to date", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null, output: "DP-4" },
        hasChild: true,
        appliedUrlArg: DEFAULT_ARG,
        appliedOutput: "DP-4",
      }),
    );
    expect(d).toMatchObject({ action: "noop", reason: "up-to-date" });
  });

  test("a successful poll resets the failure counter", () => {
    const d = decideOverlayApply(
      input({
        hasChild: true,
        appliedUrlArg: DEFAULT_ARG,
        consecutiveFailures: 4,
      }),
    );
    expect(d.consecutiveFailures).toBe(0);
  });
});

describe("decideOverlayApply: monitor cleared back to follow-osu!", () => {
  test("clearing an applied monitor is an output change", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null, output: null },
        hasChild: true,
        appliedUrlArg: DEFAULT_ARG,
        appliedOutput: "DP-4",
      }),
    );
    expect(d).toMatchObject({
      action: "spawn",
      reason: "output-changed",
      stopRunning: true,
      output: null,
      urlArg: DEFAULT_ARG,
    });
  });
});

describe("decideOverlayApply: restart nonce (D-NEW-1)", () => {
  test("a fresh nonce restarts a running host even when up to date", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null, restartAt: 1234 },
        hasChild: true,
        appliedUrlArg: DEFAULT_ARG,
        appliedRestartAt: 1000,
      }),
    );
    expect(d).toMatchObject({
      action: "spawn",
      reason: "restart-requested",
      stopRunning: true,
      restartAt: 1234,
    });
  });

  test("a fresh nonce bypasses the respawn gap on an exited child", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null, restartAt: 1234 },
        hasChild: true,
        childExited: true,
        appliedUrlArg: DEFAULT_ARG,
        appliedRestartAt: 1000,
        spawnedAt: 1_000_000 - 1000,
      }),
    );
    expect(d).toMatchObject({
      action: "spawn",
      reason: "restart-requested",
      stopRunning: false,
      restartAt: 1234,
    });
  });

  test("an already-applied nonce stays up to date", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null, restartAt: 1234 },
        hasChild: true,
        appliedUrlArg: DEFAULT_ARG,
        appliedRestartAt: 1234,
      }),
    );
    expect(d).toMatchObject({ action: "noop", reason: "up-to-date" });
  });

  test("no nonce yet means no restart request", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null },
        hasChild: true,
        appliedUrlArg: DEFAULT_ARG,
        appliedRestartAt: null,
      }),
    );
    expect(d).toMatchObject({ action: "noop", reason: "up-to-date" });
  });

  test("a nonce without a child falls through to the initial spawn", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null, restartAt: 1234 },
        hasChild: false,
        appliedRestartAt: null,
      }),
    );
    expect(d).toMatchObject({
      action: "spawn",
      reason: "initial",
      stopRunning: false,
      restartAt: 1234,
    });
  });

  test("a restart request outranks an unchanged url on an exited child inside the gap", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: null, restartAt: 1234 },
        hasChild: true,
        childExited: true,
        appliedUrlArg: DEFAULT_ARG,
        appliedRestartAt: 1000,
        spawnedAt: 1_000_000 - 1000,
      }),
    );
    expect(d.reason).toBe("restart-requested");
  });

  test("spawn decisions carry the current nonce so it stays applied", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: true, hostUrl: "http://new/#/overlay", restartAt: 1234 },
        hasChild: true,
        appliedUrlArg: "--url=http://old/#/overlay",
        appliedRestartAt: 1234,
      }),
    );
    expect(d).toMatchObject({
      action: "spawn",
      reason: "url-changed",
      restartAt: 1234,
    });
  });

  test("disabled ignores a restart nonce", () => {
    const d = decideOverlayApply(
      input({
        settings: { enabled: false, hostUrl: null, restartAt: 1234 },
        hasChild: true,
      }),
    );
    expect(d).toMatchObject({ action: "stop", reason: "disabled" });
  });
});

describe("decideOverlayApply: crash-loop backoff and park (DD-10)", () => {
  const exited = (overrides = {}) =>
    input({
      hasChild: true,
      childExited: true,
      appliedUrlArg: DEFAULT_ARG,
      childExitCode: 1,
      childUptimeMs: 500,
      ...overrides,
    });

  test("the gap doubles per quick death and is capped", () => {
    expect(overlayRespawnGapMs(GAP, 0)).toBe(GAP);
    expect(overlayRespawnGapMs(GAP, 1)).toBe(2 * GAP);
    expect(overlayRespawnGapMs(GAP, 3)).toBe(8 * GAP);
    expect(overlayRespawnGapMs(GAP, 50)).toBe(OVERLAY_MAX_RESPAWN_GAP_MS);
  });

  test("a liveness respawn counts the failure and waits the doubled gap next", () => {
    const first = decideOverlayApply(exited({ spawnedAt: 1_000_000 - GAP }));
    expect(first).toMatchObject({ action: "spawn", reason: "liveness-respawn", respawnFailures: 1 });
    const tooSoon = decideOverlayApply(
      exited({ respawnFailures: 1, spawnedAt: 1_000_000 - GAP - 1 }),
    );
    expect(tooSoon).toMatchObject({ action: "noop", reason: "respawn-gap", respawnFailures: 1 });
    const later = decideOverlayApply(exited({ respawnFailures: 1, spawnedAt: 1_000_000 - 2 * GAP }));
    expect(later).toMatchObject({ action: "spawn", respawnFailures: 2 });
  });

  test("parks after the respawn budget", () => {
    const d = decideOverlayApply(exited({ respawnFailures: OVERLAY_MAX_RESPAWNS, spawnedAt: 0 }));
    expect(d).toMatchObject({ action: "noop", reason: "respawn-exhausted" });
  });

  test("a host that ran long enough resets the budget", () => {
    const d = decideOverlayApply(
      exited({
        respawnFailures: OVERLAY_MAX_RESPAWNS,
        childUptimeMs: OVERLAY_STABLE_UPTIME_MS,
        spawnedAt: 0,
      }),
    );
    expect(d).toMatchObject({ action: "spawn", reason: "liveness-respawn", respawnFailures: 1 });
  });

  test("exit 78 (session cannot host the overlay) is never respawned", () => {
    const d = decideOverlayApply(exited({ childExitCode: OVERLAY_EXIT_UNSUPPORTED, spawnedAt: 0 }));
    expect(d).toMatchObject({ action: "noop", reason: "unsupported-session" });
  });

  test("a restart request, URL or monitor change un-parks", () => {
    const restart = decideOverlayApply(
      exited({
        childExitCode: OVERLAY_EXIT_UNSUPPORTED,
        settings: { enabled: true, hostUrl: null, restartAt: 5 },
      }),
    );
    expect(restart).toMatchObject({ action: "spawn", reason: "restart-requested", respawnFailures: 0 });
    const url = decideOverlayApply(
      exited({
        respawnFailures: OVERLAY_MAX_RESPAWNS,
        settings: { enabled: true, hostUrl: "http://127.0.0.1:4321/#/overlay" },
      }),
    );
    expect(url).toMatchObject({ action: "spawn", reason: "url-changed", respawnFailures: 0 });
    const output = decideOverlayApply(
      exited({
        respawnFailures: OVERLAY_MAX_RESPAWNS,
        settings: { enabled: true, hostUrl: null, output: "DP-1" },
      }),
    );
    expect(output).toMatchObject({ action: "spawn", reason: "output-changed", respawnFailures: 0 });
  });

  test("disabling clears the budget", () => {
    const d = decideOverlayApply(
      exited({ respawnFailures: OVERLAY_MAX_RESPAWNS, settings: { enabled: false, hostUrl: null } }),
    );
    expect(d).toMatchObject({ action: "stop", reason: "disabled", respawnFailures: 0 });
  });
});
