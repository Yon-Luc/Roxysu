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

describe("stopChild lifeline-first stop (DD-4)", () => {
  /** @param {string[]} order */
  function withStdin(child, order) {
    child.stdin = { end: () => order.push("stdin.end") };
    const kill = child.kill;
    child.kill = (signal) => {
      order.push(signal);
      return kill(signal);
    };
    return child;
  }

  test("POSIX: stdin is closed before SIGTERM", async () => {
    const order = [];
    const child = withStdin(fakeChild(), order);
    const p = stopChild(child, "server", { graceMs: 1000, killDeadlineMs: 50, platform: "linux" });
    expect(order).toEqual(["stdin.end", "SIGTERM"]);
    child.exitCode = 0;
    child.emit("exit", 0, null);
    await p;
  });

  test("Windows: no SIGTERM (it would be TerminateProcess); exit on stdin EOF resolves", async () => {
    const order = [];
    const child = withStdin(fakeChild(), order);
    const p = stopChild(child, "server", { graceMs: 1000, killDeadlineMs: 50, platform: "win32" });
    expect(order).toEqual(["stdin.end"]);
    child.exitCode = 0;
    child.emit("exit", 0, null);
    await p;
    expect(order).toEqual(["stdin.end"]);
  });

  test("Windows: a child that ignores stdin EOF is killed after the grace", async () => {
    const order = [];
    const child = withStdin(fakeChild(), order);
    await stopChild(child, "server", { graceMs: 20, killDeadlineMs: 20, platform: "win32" });
    expect(order).toEqual(["stdin.end", "SIGKILL"]);
  });

  test("a throwing stdin.end does not block the stop", async () => {
    const child = fakeChild();
    child.stdin = {
      end: () => {
        throw new Error("EPIPE");
      },
    };
    const logs = [];
    const p = stopChild(child, "server", {
      graceMs: 1000,
      killDeadlineMs: 50,
      platform: "linux",
      log: (m) => logs.push(m),
    });
    expect(child.signals).toEqual(["SIGTERM"]);
    child.exitCode = 0;
    child.emit("exit", 0, null);
    await p;
    expect(logs[0]).toContain("failed to close server stdin");
  });
});
