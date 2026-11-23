import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  RENDERER_MAX_CRASHES,
  RENDERER_STABLE_MS,
  decideRendererGone,
  reloadActionFor,
  serverStateForRespawn,
} = require("./windowRecovery.js");

const ORIGIN = "http://127.0.0.1:4321";

describe("serverStateForRespawn (DD-6)", () => {
  test("maps a respawn decision to the banner payload", () => {
    expect(serverStateForRespawn({ failures: 2, delayMs: 4000 }, 6)).toEqual({
      state: "restarting",
      attempt: 2,
      maxAttempts: 6,
      delayMs: 4000,
    });
  });

  test("never reports attempt 0 or a negative delay", () => {
    expect(serverStateForRespawn({ failures: 0, delayMs: -5 }, 6)).toMatchObject({
      attempt: 1,
      delayMs: 0,
    });
  });
});

describe("reloadActionFor (DD-6)", () => {
  test("an app URL reloads in place so the hash route survives", () => {
    expect(reloadActionFor(`${ORIGIN}/#/sessions?id=4`, ORIGIN)).toBe("reload");
  });

  test("the splash, an error page or junk loads the app root", () => {
    expect(reloadActionFor("file:///opt/roxysu/splash.html", ORIGIN)).toBe("load");
    expect(reloadActionFor("chrome-error://chromewebdata/", ORIGIN)).toBe("load");
    expect(reloadActionFor("", ORIGIN)).toBe("load");
    expect(reloadActionFor("http://127.0.0.1:4322/", ORIGIN)).toBe("load");
  });
});

describe("decideRendererGone (DD-7)", () => {
  const base = { crashes: 0, lastCrashAt: 0, now: 1_000_000 };

  test("clean exit is ignored", () => {
    expect(decideRendererGone({ ...base, reason: "clean-exit" })).toEqual({
      action: "ignore",
      crashes: 0,
    });
  });

  test("crashes reload until the cap, then go fatal", () => {
    let state = { crashes: 0, lastCrashAt: 0 };
    for (let i = 1; i <= RENDERER_MAX_CRASHES; i++) {
      const d = decideRendererGone({ ...state, reason: "crashed", now: 1000 + i });
      expect(d).toEqual({ action: "reload", crashes: i });
      state = { crashes: d.crashes, lastCrashAt: 1000 + i };
    }
    expect(decideRendererGone({ ...state, reason: "oom", now: 2000 }).action).toBe("fatal");
  });

  test("a renderer that stayed up for a minute resets the counter", () => {
    const d = decideRendererGone({
      reason: "crashed",
      crashes: RENDERER_MAX_CRASHES,
      lastCrashAt: 1000,
      now: 1000 + RENDERER_STABLE_MS,
    });
    expect(d).toEqual({ action: "reload", crashes: 1 });
  });
});
