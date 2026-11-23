import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  MAX_OVERLAY_SETTINGS_BYTES,
  parseOverlaySettingsResponse,
  readCappedBody,
} = require("./overlaySettings.js");

const VALID = JSON.stringify({
  overlay: { enabled: true, hostUrl: null, output: null },
});

describe("parseOverlaySettingsResponse", () => {
  test("a valid 200 document parses", () => {
    expect(
      parseOverlaySettingsResponse(
        200,
        JSON.stringify({
          overlay: {
            enabled: false,
            hostUrl: "http://127.0.0.1:4321/#/overlay?bg=clear",
            output: "DP-4",
            restartAt: 1234,
          },
        }),
      ),
    ).toEqual({
      enabled: false,
      hostUrl: "http://127.0.0.1:4321/#/overlay?bg=clear",
      output: "DP-4",
      restartAt: 1234,
    });
  });

  test("a 500 error document is a failed poll, not a disable-bypassing enable", () => {
    expect(parseOverlaySettingsResponse(500, '{"error":"db"}')).toBeNull();
  });

  test("non-200 statuses all fail", () => {
    expect(parseOverlaySettingsResponse(404, VALID)).toBeNull();
    expect(parseOverlaySettingsResponse(204, "")).toBeNull();
    expect(parseOverlaySettingsResponse(302, "")).toBeNull();
  });

  test("a document without an overlay object fails", () => {
    expect(parseOverlaySettingsResponse(200, '{"error":"nope"}')).toBeNull();
    expect(parseOverlaySettingsResponse(200, "{}")).toBeNull();
    expect(parseOverlaySettingsResponse(200, "null")).toBeNull();
  });

  test("an overlay array is not an overlay object", () => {
    expect(parseOverlaySettingsResponse(200, '{"overlay":[]}')).toBeNull();
  });

  test("a non-boolean enabled fails instead of defaulting to true", () => {
    expect(
      parseOverlaySettingsResponse(200, '{"overlay":{"enabled":"yes"}}'),
    ).toBeNull();
    expect(parseOverlaySettingsResponse(200, '{"overlay":{}}')).toBeNull();
  });

  test("non-string hostUrl/output fall back to null", () => {
    expect(
      parseOverlaySettingsResponse(
        200,
        '{"overlay":{"enabled":true,"hostUrl":42,"output":false}}',
      ),
    ).toEqual({ enabled: true, hostUrl: null, output: null, restartAt: null });
  });

  test("blank strings trim to null (follow osu! / default URL)", () => {
    expect(
      parseOverlaySettingsResponse(
        200,
        '{"overlay":{"enabled":true,"hostUrl":"  ","output":"\\t"}}',
      ),
    ).toEqual({ enabled: true, hostUrl: null, output: null, restartAt: null });
  });

  test("invalid JSON fails", () => {
    expect(parseOverlaySettingsResponse(200, "<html>oops")).toBeNull();
  });

  test("a non-finite restartAt is dropped", () => {
    expect(
      parseOverlaySettingsResponse(
        200,
        '{"overlay":{"enabled":true,"restartAt":"1234"}}',
      ),
    ).toEqual({ enabled: true, hostUrl: null, output: null, restartAt: null });
  });
});

function fakeRes() {
  return new EventEmitter();
}

describe("readCappedBody", () => {
  test("collects chunks and resolves on end", async () => {
    const res = fakeRes();
    const promise = readCappedBody(res, 1024);
    res.emit("data", Buffer.from("hello "));
    res.emit("data", Buffer.from("world"));
    res.emit("end");
    expect(await promise).toEqual({ ok: true, text: "hello world" });
  });

  test("destroys the response past the byte cap", async () => {
    const res = fakeRes();
    let destroyed = false;
    res.destroy = () => {
      destroyed = true;
    };
    const promise = readCappedBody(res, 8);
    res.emit("data", Buffer.from("0123456789"));
    expect(await promise).toEqual({ ok: false });
    expect(destroyed).toBe(true);
  });

  test("resolves failed on error mid-stream", async () => {
    const res = fakeRes();
    const promise = readCappedBody(res, 1024);
    res.emit("data", Buffer.from("partial"));
    res.emit("error", new Error("ECONNRESET"));
    expect(await promise).toEqual({ ok: false });
  });

  test("resolves failed on abort", async () => {
    const res = fakeRes();
    const promise = readCappedBody(res, 1024);
    res.emit("aborted");
    expect(await promise).toEqual({ ok: false });
  });

  test("events after settle are ignored", async () => {
    const res = fakeRes();
    const promise = readCappedBody(res, 4);
    res.emit("data", Buffer.from("toolong"));
    expect(await promise).toEqual({ ok: false });
    res.emit("end"); // must not double-settle or throw
    res.emit("error", new Error("late"));
  });

  test("the cap matches the documented 64 KiB budget", () => {
    expect(MAX_OVERLAY_SETTINGS_BYTES).toBe(64 * 1024);
  });
});
