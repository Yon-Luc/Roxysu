import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_RESPAWN_CONFIG,
  decideRespawn,
  resolveRespawnUptimeMs,
} = require("./respawnPolicy.js");

describe("decideRespawn", () => {
  test("first short-lived exit respawns after the base delay", () => {
    expect(decideRespawn({ failures: 0, uptimeMs: 500 })).toEqual({
      action: "respawn",
      delayMs: DEFAULT_RESPAWN_CONFIG.baseDelayMs,
      failures: 1,
    });
  });

  test("delay doubles per consecutive failure and is capped", () => {
    const cfg = { baseDelayMs: 1000, maxDelayMs: 5000, maxAttempts: 10 };
    const delays = [];
    let failures = 0;
    for (let i = 0; i < 5; i++) {
      const d = decideRespawn({ failures, uptimeMs: 100 }, cfg);
      delays.push(d.delayMs);
      failures = d.failures;
    }
    expect(delays).toEqual([1000, 2000, 4000, 5000, 5000]);
  });

  test("gives up after maxAttempts consecutive short-lived runs", () => {
    const cfg = { maxAttempts: 3 };
    let failures = 0;
    const actions = [];
    for (let i = 0; i < 4; i++) {
      const d = decideRespawn({ failures, uptimeMs: 100 }, cfg);
      actions.push(d.action);
      failures = d.failures;
    }
    expect(actions).toEqual(["respawn", "respawn", "respawn", "give-up"]);
  });

  test("a stable run resets the counter", () => {
    const d = decideRespawn(
      { failures: 5, uptimeMs: DEFAULT_RESPAWN_CONFIG.stableUptimeMs },
      {},
    );
    expect(d).toEqual({
      action: "respawn",
      delayMs: DEFAULT_RESPAWN_CONFIG.baseDelayMs,
      failures: 1,
    });
  });

  test("a stable run avoids give-up even at the attempt limit", () => {
    const cfg = { maxAttempts: 2 };
    const d = decideRespawn({ failures: 2, uptimeMs: 10 * 60_000 }, cfg);
    expect(d.action).toBe("respawn");
  });

  test("non-finite uptime counts as a short-lived run", () => {
    const d = decideRespawn({ failures: 1, uptimeMs: Number.NaN });
    expect(d.action).toBe("respawn");
    expect(d.failures).toBe(2);
  });
});

describe("resolveRespawnUptimeMs", () => {
  test("raw uptime is used when no health time is supplied", () => {
    expect(resolveRespawnUptimeMs({ uptimeMs: 1234 })).toBe(1234);
    expect(resolveRespawnUptimeMs({ uptimeMs: Number.NaN })).toBe(0);
    expect(resolveRespawnUptimeMs({})).toBe(0);
  });

  test("health time wins over raw uptime", () => {
    expect(
      resolveRespawnUptimeMs({ uptimeMs: 180_000, healthyAt: 1_000, now: 61_000 }),
    ).toBe(60_000);
  });

  test("a clock that moved backwards never yields negative uptime", () => {
    expect(resolveRespawnUptimeMs({ healthyAt: 10_000, now: 5_000 })).toBe(0);
  });

  test("a supplied null healthyAt means the run was never healthy", () => {
    expect(resolveRespawnUptimeMs({ uptimeMs: 180_000, healthyAt: null })).toBe(0);
    expect(resolveRespawnUptimeMs({ healthyAt: Number.NaN, now: 1 })).toBe(0);
  });
});

describe("decideRespawn health-aware uptime (D-NEW-2)", () => {
  test("a child that stayed alive 180s but never became healthy counts as a failure", () => {
    const d = decideRespawn({
      failures: 0,
      uptimeMs: 180_000,
      healthyAt: null,
      now: 180_000,
    });
    expect(d).toEqual({
      action: "respawn",
      delayMs: DEFAULT_RESPAWN_CONFIG.baseDelayMs,
      failures: 1,
    });
  });

  test("healthy then long uptime resets the counter", () => {
    const healthyAt = 5_000;
    const d = decideRespawn({
      failures: 4,
      healthyAt,
      now: healthyAt + DEFAULT_RESPAWN_CONFIG.stableUptimeMs,
    });
    expect(d).toEqual({
      action: "respawn",
      delayMs: DEFAULT_RESPAWN_CONFIG.baseDelayMs,
      failures: 1,
    });
  });

  test("healthy but short uptime keeps incrementing", () => {
    const d = decideRespawn({ failures: 2, healthyAt: 1_000, now: 2_000 });
    expect(d.failures).toBe(3);
  });

  test("six never-healthy rounds give up", () => {
    const cfg = DEFAULT_RESPAWN_CONFIG;
    let failures = 0;
    const actions = [];
    let now = 0;
    for (let i = 0; i < cfg.maxAttempts; i++) {
      // Each round stays alive far longer than the stable threshold.
      now += 180_000;
      const d = decideRespawn({ failures, healthyAt: null, now, uptimeMs: now });
      actions.push(d.action);
      failures = d.failures;
    }
    expect(actions).toEqual(Array(cfg.maxAttempts).fill("respawn"));
    const last = decideRespawn({
      failures,
      healthyAt: null,
      now: now + 180_000,
      uptimeMs: now + 180_000,
    });
    expect(last.action).toBe("give-up");
    expect(last.failures).toBe(cfg.maxAttempts + 1);
  });
});
