import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DEFAULT_RESPAWN_CONFIG, decideRespawn } = require("./respawnPolicy.js");

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
