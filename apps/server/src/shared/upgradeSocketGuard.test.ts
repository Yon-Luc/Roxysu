import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import {
  guardUpgradeSocketErrors,
  isClientDisconnectError,
} from "./upgradeSocketGuard";

type FakeServer = EventEmitter & { emitUpgrade(socket: EventEmitter): void };

function fakeServeInfo() {
  const server = new EventEmitter() as FakeServer;
  server.emitUpgrade = (socket) => server.emit("upgrade", {}, socket);
  return { info: { raw: { node: { server } } }, server };
}

function err(code: string) {
  const error = new Error(`write ${code}`) as Error & { code: string };
  error.code = code;
  return error;
}

describe("isClientDisconnectError", () => {
  test("accepts client-gone socket codes", () => {
    expect(isClientDisconnectError(err("EPIPE"))).toBe(true);
    expect(isClientDisconnectError(err("ECONNRESET"))).toBe(true);
    expect(isClientDisconnectError(err("ECONNABORTED"))).toBe(true);
  });

  test("rejects anything else", () => {
    expect(isClientDisconnectError(err("EACCES"))).toBe(false);
    expect(isClientDisconnectError(new Error("boom"))).toBe(false);
    expect(isClientDisconnectError(null)).toBe(false);
    expect(isClientDisconnectError("EPIPE")).toBe(false);
  });
});

describe("guardUpgradeSocketErrors", () => {
  test("a hung-up upgrade socket does not throw EPIPE", () => {
    const { info, server } = fakeServeInfo();
    const logged: unknown[] = [];
    expect(
      guardUpgradeSocketErrors(info, (_message, error) => logged.push(error)),
    ).toBe(true);

    const socket = new EventEmitter();
    server.emitUpgrade(socket);

    expect(() => socket.emit("error", err("EPIPE"))).not.toThrow();
    expect(() => socket.emit("error", err("ECONNRESET"))).not.toThrow();
    expect(logged).toEqual([]);
  });

  test("other socket errors are still logged", () => {
    const { info, server } = fakeServeInfo();
    const logged: unknown[] = [];
    guardUpgradeSocketErrors(info, (_message, error) => logged.push(error));

    const socket = new EventEmitter();
    server.emitUpgrade(socket);

    const boom = err("EACCES");
    socket.emit("error", boom);
    expect(logged).toEqual([boom]);
  });

  test("guards each server once", () => {
    const { info, server } = fakeServeInfo();
    expect(guardUpgradeSocketErrors(info)).toBe(true);
    expect(guardUpgradeSocketErrors(info)).toBe(true);
    expect(server.listenerCount("upgrade")).toBe(1);
  });

  test("reports when the Node HTTP server is unavailable", () => {
    const logged: unknown[] = [];
    const report = (_message: string, error: unknown) => logged.push(error);
    expect(guardUpgradeSocketErrors(undefined, report)).toBe(false);
    expect(guardUpgradeSocketErrors({ raw: {} }, report)).toBe(false);
    expect(logged).toEqual([null, null]);
  });
});
