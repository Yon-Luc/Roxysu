import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createApplyGate,
  executeOverlayDecision,
} = require("./overlayApplyLoop.js");

describe("createApplyGate", () => {
  test("first begin opens the gate", () => {
    const gate = createApplyGate();
    expect(gate.begin()).toBe(true);
  });

  test("a begin during flight coalesces instead of running", () => {
    const gate = createApplyGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    expect(gate.begin()).toBe(false);
  });

  test("end reports exactly one coalesced re-run", () => {
    const gate = createApplyGate();
    gate.begin();
    gate.begin();
    gate.begin();
    expect(gate.end()).toBe(true);
    expect(gate.end()).toBe(false);
  });

  test("the gate reopens after end", () => {
    const gate = createApplyGate();
    gate.begin();
    gate.end();
    expect(gate.begin()).toBe(true);
  });
});

describe("executeOverlayDecision", () => {
  test("spawn with stopRunning does not spawn until stop resolves", async () => {
    let spawned = false;
    /** @type {() => void} */
    let resolveStop = () => {};
    const stop = () =>
      new Promise((resolve) => {
        resolveStop = resolve;
      });
    const promise = executeOverlayDecision(
      { action: "spawn", reason: "url-changed", stopRunning: true, urlArg: "--url=a", output: null },
      { stop, spawn: () => { spawned = true; } },
    );
    // Synchronously suspended inside `await stop()` — nothing spawned yet.
    expect(spawned).toBe(false);
    resolveStop();
    await promise;
    expect(spawned).toBe(true);
  });

  test("spawn without stopRunning never stops and passes urlArg and output", async () => {
    let stopped = 0;
    /** @type {string | undefined} */
    let urlArg;
    /** @type {string | null | undefined} */
    let output;
    await executeOverlayDecision(
      { action: "spawn", reason: "initial", stopRunning: false, urlArg: "--url=b", output: "DP-4" },
      {
        stop: () => { stopped += 1; return Promise.resolve(); },
        spawn: (a, o) => { urlArg = a; output = o; },
      },
    );
    expect(stopped).toBe(0);
    expect(urlArg).toBe("--url=b");
    expect(output).toBe("DP-4");
  });

  test("a missing output spawns as null (follow the window)", async () => {
    /** @type {string | null | undefined} */
    let output = "unset";
    await executeOverlayDecision(
      { action: "spawn", reason: "initial", stopRunning: false, urlArg: "--url=c" },
      { stop: () => Promise.resolve(), spawn: (_a, o) => { output = o; } },
    );
    expect(output).toBe(null);
  });

  test("stop awaits the stop promise and never spawns", async () => {
    let spawned = false;
    let resolveStop = () => {};
    const stop = () =>
      new Promise((resolve) => {
        resolveStop = resolve;
      });
    const promise = executeOverlayDecision(
      { action: "stop", reason: "disabled" },
      { stop, spawn: () => { spawned = true; } },
    );
    expect(spawned).toBe(false);
    resolveStop();
    await promise;
    expect(spawned).toBe(false);
  });

  test("noop touches nothing", async () => {
    let calls = 0;
    await executeOverlayDecision(
      { action: "noop", reason: "up-to-date" },
      {
        stop: () => { calls += 1; return Promise.resolve(); },
        spawn: () => { calls += 1; },
      },
    );
    expect(calls).toBe(0);
  });
});

describe("gate + decision combined (the main.js apply shape)", () => {
  test("overlapping polls run once, then one coalesced re-run", async () => {
    const gate = createApplyGate();
    let runs = 0;
    const apply = async () => {
      if (!gate.begin()) return;
      try {
        runs += 1;
        await executeOverlayDecision(
          { action: "spawn", reason: "initial", stopRunning: true, urlArg: "--url=x", output: null },
          { stop: () => Promise.resolve(), spawn: () => {} },
        );
      } finally {
        if (gate.end()) void apply();
      }
    };
    const first = apply();
    apply(); // poll tick during flight — coalesced
    apply(); // second tick during flight — still one coalesced re-run
    await first;
    expect(runs).toBe(2); // original + exactly one coalesced follow-up
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs).toBe(2); // no runaway re-runs
  });
});
