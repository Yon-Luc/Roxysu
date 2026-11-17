import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { appOrigin, isAppUrl, canOpenExternal, senderIsApp } = require("./urlPolicy.js");

const origin = appOrigin("127.0.0.1", 4321);

describe("urlPolicy", () => {
  test("app origin matches the loaded UI, including the overlay hash", () => {
    expect(isAppUrl("http://127.0.0.1:4321/", origin)).toBe(true);
    expect(isAppUrl("http://127.0.0.1:4321/#/overlay", origin)).toBe(true);
    expect(isAppUrl("http://127.0.0.1:4321/api/system/healthz", origin)).toBe(true);
  });

  test("foreign, file, and javascript URLs are not the app", () => {
    expect(isAppUrl("http://evil.example/", origin)).toBe(false);
    expect(isAppUrl("https://osu.ppy.sh/users/1", origin)).toBe(false);
    expect(isAppUrl("file:///etc/passwd", origin)).toBe(false);
    expect(isAppUrl("javascript:alert(1)", origin)).toBe(false);
    expect(isAppUrl("not a url", origin)).toBe(false);
  });

  test("http(s) and osu: may be opened externally", () => {
    expect(canOpenExternal("https://osu.ppy.sh/users/1")).toBe(true);
    expect(canOpenExternal("http://127.0.0.1:4322/auth/login")).toBe(true);
    expect(canOpenExternal("osu://b/1")).toBe(true);
    expect(canOpenExternal("file:///tmp/x")).toBe(false);
    expect(canOpenExternal("javascript:alert(1)")).toBe(false);
  });

  test("IPC sender must be a non-empty app URL", () => {
    expect(senderIsApp("http://127.0.0.1:4321/#/hub", origin)).toBe(true);
    expect(senderIsApp("https://osu.ppy.sh/", origin)).toBe(false);
    expect(senderIsApp("", origin)).toBe(false);
    expect(senderIsApp(undefined, origin)).toBe(false);
  });
});
