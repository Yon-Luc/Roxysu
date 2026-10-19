import { beforeEach, describe, expect, test } from "bun:test";
import type { Db } from "@roxysu/db/types";
import { __tosuLiveTest as t, startTosuAdapter } from "./live";
import { MAX_SPAWN_ATTEMPTS } from "./spawnGate";

const down = { httpUp: false, warnings: ["Tosu is not reachable at h."] };
const up = { httpUp: true, warnings: [] as string[] };

let published: unknown[];
let spawns: string[];
let probeResult: { httpUp: boolean; warnings: string[] };
let spawnResult: { ok: true; pid: number } | { ok: false; warning: string };
let pidAlive: boolean;

beforeEach(() => {
  published = [];
  spawns = [];
  probeResult = up;
  spawnResult = { ok: true, pid: 99 };
  pidAlive = false;
  t.deps.publish = ((e: unknown) => {
    published.push(e);
  }) as typeof t.deps.publish;
  t.deps.probeTosuHttp = (async () => probeResult) as typeof t.deps.probeTosuHttp;
  t.deps.spawnTosu = ((p: string) => {
    spawns.push(p);
    return spawnResult;
  }) as typeof t.deps.spawnTosu;
  t.deps.isPidAlive = () => pidAlive;
  t.deps.readTosuSettings = (async () => ({
    enabled: true,
    host: "h",
    executablePath: "/bin/tosu",
  })) as typeof t.deps.readTosuSettings;
  t.init(
    { enabled: true, host: "h", executablePath: "/bin/tosu" },
    {} as Db,
  );
});

describe("probe tick publishing (F-036)", () => {
  test("connected probe with unchanged warnings publishes nothing", async () => {
    t.setStatus("connected");
    await t.runProbeTick();
    await t.runProbeTick();
    expect(published).toEqual([]);
  });

  test("connected probe publishes once when warnings change", async () => {
    t.setStatus("connected");
    probeResult = { httpUp: true, warnings: ["odd"] };
    await t.runProbeTick();
    await t.runProbeTick();
    expect(published).toEqual([{ type: "tosu.updated", reason: "full" }]);
  });
});

describe("auto-start gate (F-006)", () => {
  test("does not spawn while the connected probe is up", async () => {
    t.setStatus("connected");
    await t.runProbeTick();
    expect(spawns).toEqual([]);
  });

  test("spawns once, then skips while the pid is alive", async () => {
    probeResult = down;
    await t.runProbeTick();
    expect(spawns).toEqual(["/bin/tosu"]);
    pidAlive = true;
    await t.runProbeTick();
    await t.runProbeTick();
    expect(spawns).toHaveLength(1);
    expect(t.getWarnings().join(" ")).toContain("pid 99");
  });

  test("does not respawn inside the cooldown window", async () => {
    probeResult = down;
    await t.runProbeTick();
    await t.runProbeTick();
    expect(spawns).toHaveLength(1);
  });

  test("gives up after repeated failed spawns and warns", async () => {
    probeResult = down;
    spawnResult = { ok: false, warning: "boom" };
    for (let i = 0; i < MAX_SPAWN_ATTEMPTS; i++) {
      // Force the cooldown to elapse between attempts.
      t.spawnGate.lastAttemptAt = 0;
      await t.runProbeTick();
    }
    expect(spawns).toHaveLength(MAX_SPAWN_ATTEMPTS);
    t.spawnGate.lastAttemptAt = 0;
    await t.runProbeTick();
    expect(spawns).toHaveLength(MAX_SPAWN_ATTEMPTS);
    expect(t.getWarnings().join(" ")).toContain("gave up");
  });

  test("a reachable probe resets the gate", async () => {
    probeResult = down;
    spawnResult = { ok: false, warning: "boom" };
    t.spawnGate.lastAttemptAt = 0;
    await t.runProbeTick();
    expect(t.spawnGate.failedAttempts).toBe(1);
    probeResult = up;
    await t.runProbeTick();
    expect(t.spawnGate.failedAttempts).toBe(0);
    expect(t.spawnGate.lastPid).toBeNull();
  });

  test("an in-flight probe does not spawn after live is disabled", async () => {
    let release: (value: typeof down) => void = () => {};
    t.deps.probeTosuHttp = (() =>
      new Promise((resolve) => {
        release = resolve;
      })) as typeof t.deps.probeTosuHttp;
    const pending = t.runProbeTick();
    t.deps.readTosuSettings = (async () => ({
      enabled: false,
      host: "h",
      executablePath: "/bin/tosu",
    })) as typeof t.deps.readTosuSettings;
    const disabling = startTosuAdapter({} as Db);
    release(down);
    await pending;
    await disabling;
    expect(spawns).toEqual([]);
    expect(t.getWarnings()).toEqual([]);
  });

  test("a probe that resolves without a restart still spawns when http is down", async () => {
    let release: (value: typeof down) => void = () => {};
    t.deps.probeTosuHttp = (() =>
      new Promise((resolve) => {
        release = resolve;
      })) as typeof t.deps.probeTosuHttp;
    const pending = t.runProbeTick();
    release(down);
    await pending;
    expect(spawns).toEqual(["/bin/tosu"]);
  });

  test("missing executable path warns without spawning", async () => {
    probeResult = down;
    t.init({ enabled: true, host: "h", executablePath: null }, {} as Db);
    await t.runProbeTick();
    expect(spawns).toEqual([]);
    expect(t.getWarnings().join(" ")).toContain("executable path");
  });
});
