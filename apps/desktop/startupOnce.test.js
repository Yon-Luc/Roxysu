import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createOnceGuard } = require("./startupOnce.js");

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
