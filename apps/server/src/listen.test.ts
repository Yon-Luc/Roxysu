import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import {
  EXIT_ADDR_IN_USE,
  addrInUseMessage,
  armNodeListen,
  isAddrInUseError,
  listenExposureWarning,
  listenUrl,
  resolveListen,
} from "./listen";

describe("resolveListen", () => {
  test("defaults to 127.0.0.1:4321", () => {
    expect(resolveListen({})).toEqual({ port: 4321, hostname: "127.0.0.1" });
  });

  test("ROXYSU_PORT wins over PORT", () => {
    expect(resolveListen({ ROXYSU_PORT: "4400", PORT: "4500" })).toEqual({
      port: 4400,
      hostname: "127.0.0.1",
    });
  });

  test("PORT is the fallback", () => {
    expect(resolveListen({ PORT: "4500", ROXYSU_HOST: "127.0.0.1" })).toEqual({
      port: 4500,
      hostname: "127.0.0.1",
    });
  });

  test("honours an explicit host, including a non-loopback one", () => {
    expect(resolveListen({ ROXYSU_HOST: "0.0.0.0" }).hostname).toBe("0.0.0.0");
  });

  test("resolves localhost to loopback instead of binding every interface", () => {
    expect(resolveListen({ ROXYSU_HOST: "localhost" }).hostname).toBe("127.0.0.1");
    expect(resolveListen({ ROXYSU_HOST: "  localhost  " }).hostname).toBe(
      "127.0.0.1",
    );
  });

  test("rejects a port that is not an integer in range", () => {
    expect(() => resolveListen({ ROXYSU_PORT: "nope" })).toThrow(/ROXYSU_PORT/);
    expect(() => resolveListen({ ROXYSU_PORT: "0" })).toThrow(/ROXYSU_PORT/);
    expect(() => resolveListen({ ROXYSU_PORT: "70000" })).toThrow(/ROXYSU_PORT/);
  });
});

describe("listenExposureWarning", () => {
  test("warns for every-interface binds and the localhost name", () => {
    expect(listenExposureWarning("0.0.0.0")).toContain("ROXYSU_HOST=0.0.0.0");
    expect(listenExposureWarning("::")).toContain("ROXYSU_HOST=::");
    expect(listenExposureWarning("localhost")).toContain("localhost");
  });

  test("is quiet for loopback addresses", () => {
    expect(listenExposureWarning("127.0.0.1")).toBeNull();
    expect(listenExposureWarning("::1")).toBeNull();
  });
});

describe("listenUrl", () => {
  test("brackets IPv6 hosts", () => {
    expect(listenUrl({ port: 4321, hostname: "::1" })).toBe("http://[::1]:4321");
  });
});

describe("isAddrInUseError", () => {
  test("matches the node code and bun's message", () => {
    expect(isAddrInUseError(Object.assign(new Error("busy"), { code: "EADDRINUSE" }))).toBe(
      true,
    );
    expect(isAddrInUseError(new Error("Failed to start server. Is port 4321 in use?"))).toBe(
      true,
    );
    expect(isAddrInUseError(new Error("nope"))).toBe(false);
  });
});

describe("armNodeListen", () => {
  test("EADDRINUSE exits before background work starts", () => {
    const server = new EventEmitter() as EventEmitter & { listening: boolean };
    server.listening = false;
    let started = false;
    let code = -1;
    const lines: string[] = [];
    armNodeListen(
      { raw: { node: { server } } },
      4321,
      () => {
        started = true;
      },
      (exitCode: number) => {
        code = exitCode;
      },
      (message) => lines.push(message),
    );
    server.emit("error", Object.assign(new Error("in use"), { code: "EADDRINUSE" }));
    expect(started).toBe(false);
    expect(code).toBe(EXIT_ADDR_IN_USE);
    expect(code).toBe(98);
    expect(lines).toEqual([addrInUseMessage(4321)]);
  });

  test("starts work when the socket is listening", () => {
    const server = new EventEmitter() as EventEmitter & { listening: boolean };
    server.listening = false;
    let started = false;
    armNodeListen(
      { raw: { node: { server } } },
      4321,
      () => {
        started = true;
      },
      () => {},
    );
    expect(started).toBe(false);
    server.emit("listening");
    expect(started).toBe(true);
  });

  test("starts immediately when the socket is already listening", () => {
    const server = new EventEmitter() as EventEmitter & { listening: boolean };
    server.listening = true;
    let started = false;
    armNodeListen(
      { raw: { node: { server } } },
      4321,
      () => {
        started = true;
      },
      () => {},
    );
    expect(started).toBe(true);
  });
});
