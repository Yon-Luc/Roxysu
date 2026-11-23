import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createOnceGuard, createStartupJoin } = require("./startupOnce.js");

describe("createOnceGuard", () => {
  test("first run returns true and calls fn once", () => {
    const guard = createOnceGuard();
    let calls = 0;
    expect(guard.used()).toBe(false);
    expect(
      guard.run(() => {
        calls += 1;
      }),
    ).toBe(true);
    expect(calls).toBe(1);
  });

  test("second run returns false and does not call fn again", () => {
    const guard = createOnceGuard();
    let calls = 0;
    const fn = () => {
      calls += 1;
    };
    expect(guard.run(fn)).toBe(true);
    expect(guard.run(fn)).toBe(false);
    expect(calls).toBe(1);
    expect(guard.used()).toBe(true);
  });

  test("used() is false before and true after", () => {
    const guard = createOnceGuard();
    expect(guard.used()).toBe(false);
    guard.run(() => {});
    expect(guard.used()).toBe(true);
  });
});

describe("createStartupJoin", () => {
  test("a second call during the first shares the promise and does not run fn again", async () => {
    const join = createStartupJoin();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const first = join.start(async () => {
      calls += 1;
      await gate;
      return true;
    });
    const second = join.start(async () => {
      calls += 1;
      return true;
    });
    expect(calls).toBe(1);
    expect(join.settled()).toBe(false);
    release();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(calls).toBe(1);
    expect(join.settled()).toBe(true);
  });

  test("after settle, a later call returns false and does not run fn", async () => {
    const join = createStartupJoin();
    let calls = 0;
    await expect(
      join.start(async () => {
        calls += 1;
        return true;
      }),
    ).resolves.toBe(true);
    await expect(
      join.start(async () => {
        calls += 1;
        return true;
      }),
    ).resolves.toBe(false);
    expect(calls).toBe(1);
  });
});
