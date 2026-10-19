import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OVERLAY_MAX_POLL_FAILURES,
  decideOverlayApply,
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
      input({ settings: null, hasChild: true, lastKnownEnabled: false }),
    );
    expect(d).toMatchObject({ action: "noop", consecutiveFailures: 1, lastKnownEnabled: false });
  });

  test("N failures with last known disabled stops the host", () => {
    const d = decideOverlayApply(
      input({
        settings: null,
        hasChild: true,
        lastKnownEnabled: false,
        consecutiveFailures: OVERLAY_MAX_POLL_FAILURES - 1,
      }),
    );
    expect(d).toMatchObject({
      action: "stop",
      reason: "poll-failures-while-disabled",
      consecutiveFailures: OVERLAY_MAX_POLL_FAILURES,
    });
  });

  test("N failures with last known enabled keeps running", () => {
    const d = decideOverlayApply(
      input({
        settings: null,
        hasChild: true,
        lastKnownEnabled: true,
        consecutiveFailures: 50,
      }),
    );
    expect(d.action).toBe("noop");
    expect(d.consecutiveFailures).toBe(51);
  });

  test("N failures before any successful read keeps running", () => {
    const d = decideOverlayApply(
      input({
        settings: null,
        hasChild: true,
        lastKnownEnabled: null,
        consecutiveFailures: 50,
      }),
    );
    expect(d.action).toBe("noop");
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
