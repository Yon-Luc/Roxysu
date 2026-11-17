import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { stopChild } = require("./stopChild.js");

/**
 * @param {{ exitCode?: number | null, signalCode?: string | null, kill?: (signal?: string) => boolean }} [opts]
 */
function fakeChild(opts = {}) {
  const child = new EventEmitter();
  child.exitCode = opts.exitCode ?? null;
  child.signalCode = opts.signalCode ?? null;
  child.signals = [];
  child.kill =
    opts.kill ??
    ((signal) => {
      child.signals.push(signal);
      return true;
    });
  return child;
}

describe("stopChild", () => {
  test("an already-exited child resolves without kill", async () => {
    const child = fakeChild({ exitCode: 0 });
    await stopChild(child, "server", { graceMs: 50, killDeadlineMs: 50 });
    expect(child.signals).toEqual([]);
  });

  test("resolves when the child emits exit", async () => {
    const child = fakeChild();
    child.kill = (signal) => {
      child.signals.push(signal);
      if (signal === "SIGTERM") {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      }
      return true;
    };
    await stopChild(child, "server", { graceMs: 500, killDeadlineMs: 50 });
    expect(child.signals).toEqual(["SIGTERM"]);
  });

  test("a false kill() resolves without waiting for exit", async () => {
    const child = fakeChild({
      kill: () => false,
    });
    const started = Date.now();
    await stopChild(child, "server", { graceMs: 500, killDeadlineMs: 500 });
    expect(Date.now() - started).toBeLessThan(200);
  });

  test("SIGKILL that returns false still resolves", async () => {
    const child = fakeChild();
    child.kill = (signal) => {
      child.signals.push(signal);
      return signal !== "SIGKILL";
    };
    await stopChild(child, "server", { graceMs: 20, killDeadlineMs: 500 });
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("a child that ignores SIGKILL resolves after the deadline", async () => {
    const child = fakeChild();
    const started = Date.now();
    await stopChild(child, "server", { graceMs: 20, killDeadlineMs: 30 });
    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    expect(Date.now() - started).toBeLessThan(400);
  });
});
