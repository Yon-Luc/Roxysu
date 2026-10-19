import { describe, expect, test } from "bun:test";
import {
  createSpawnGateState,
  decideSpawn,
  MAX_SPAWN_ATTEMPTS,
  recordSpawn,
  resetSpawnGate,
  SPAWN_COOLDOWN_MS,
  spawnCooldownMs,
} from "./spawnGate";

const dead = () => false;
const alive = () => true;

describe("decideSpawn", () => {
  test("first attempt spawns immediately", () => {
    expect(decideSpawn(createSpawnGateState(), 1_000, dead)).toEqual({
      spawn: true,
    });
  });

  test("skips while the previous pid is alive, with a warning", () => {
    const s = createSpawnGateState();
    recordSpawn(s, 1_000, 4242);
    const d = decideSpawn(s, 1_000 + 10 * SPAWN_COOLDOWN_MS, alive);
    expect(d.spawn).toBe(false);
    expect(d.spawn === false && d.warning).toContain("4242");
  });

  test("waits out the cooldown once the previous pid is gone", () => {
    const s = createSpawnGateState();
    recordSpawn(s, 1_000, 4242);
    expect(decideSpawn(s, 1_000 + SPAWN_COOLDOWN_MS - 1, dead)).toEqual({
      spawn: false,
      warning: null,
    });
    expect(decideSpawn(s, 1_000 + SPAWN_COOLDOWN_MS, dead)).toEqual({
      spawn: true,
    });
  });

  test("backs off exponentially", () => {
    expect(spawnCooldownMs(1)).toBe(SPAWN_COOLDOWN_MS);
    expect(spawnCooldownMs(2)).toBe(2 * SPAWN_COOLDOWN_MS);
    const s = createSpawnGateState();
    recordSpawn(s, 0, null);
    recordSpawn(s, 100_000, null);
    expect(decideSpawn(s, 100_000 + SPAWN_COOLDOWN_MS, dead)).toEqual({
      spawn: false,
      warning: null,
    });
    expect(decideSpawn(s, 100_000 + 2 * SPAWN_COOLDOWN_MS, dead)).toEqual({
      spawn: true,
    });
  });

  test("gives up after the attempt cap and warns", () => {
    const s = createSpawnGateState();
    for (let i = 0; i < MAX_SPAWN_ATTEMPTS; i++) recordSpawn(s, i, null);
    const d = decideSpawn(s, 1e12, dead);
    expect(d.spawn).toBe(false);
    expect(d.spawn === false && d.warning).toContain("gave up");
  });

  test("reset clears pid, failures and cooldown", () => {
    const s = createSpawnGateState();
    for (let i = 0; i < MAX_SPAWN_ATTEMPTS; i++) recordSpawn(s, i, 1);
    resetSpawnGate(s);
    expect(decideSpawn(s, 5, alive)).toEqual({ spawn: true });
  });
});
