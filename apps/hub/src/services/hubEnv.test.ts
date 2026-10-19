import { describe, expect, test } from "bun:test";
import {
  HUB_DEFAULT_CLIENT_ORIGINS,
  isHubPublished,
  isLoopbackHost,
  isHubProduction,
  isHubSearchHttpCacheEnabled,
  isHubSearchIndexEnabled,
  resolveCorsOrigin,
} from "./hubEnv";

describe("isHubProduction", () => {
  test("reads HUB_ENV or NODE_ENV", () => {
    expect(isHubProduction({ HUB_ENV: "production" })).toBe(true);
    expect(isHubProduction({ NODE_ENV: "production" })).toBe(true);
    expect(isHubProduction({ NODE_ENV: "development" })).toBe(false);
    expect(isHubProduction({})).toBe(false);
  });
});

describe("search kill switches", () => {
  test("index and http cache default on", () => {
    expect(isHubSearchIndexEnabled({})).toBe(true);
    expect(isHubSearchHttpCacheEnabled({})).toBe(true);
  });

  test("accepts 0/false/off", () => {
    expect(isHubSearchIndexEnabled({ HUB_SEARCH_INDEX: "0" })).toBe(false);
    expect(
      isHubSearchHttpCacheEnabled({ HUB_SEARCH_HTTP_CACHE: "false" }),
    ).toBe(false);
    expect(isHubSearchHttpCacheEnabled({ HUB_SEARCH_HTTP_CACHE: "off" })).toBe(
      false,
    );
  });
});

describe("resolveCorsOrigin", () => {
  test("dev defaults to the Roxysu client loopback origins", () => {
    const expected = [...HUB_DEFAULT_CLIENT_ORIGINS];
    expect(expected).toEqual(["http://127.0.0.1:4321", "http://localhost:4321"]);
    expect(resolveCorsOrigin(undefined, {})).toEqual(expected);
    expect(resolveCorsOrigin("", {})).toEqual(expected);
    expect(resolveCorsOrigin(undefined, { HUB_LISTEN: "127.0.0.1" })).toEqual(
      expected,
    );
  });

  test("dev honours an explicit * (warned) on a non-published Hub", () => {
    expect(resolveCorsOrigin("*", {})).toBe("*");
  });

  test("a non-loopback HUB_LISTEN requires an explicit list like production", () => {
    const published = { HUB_LISTEN: "0.0.0.0" };
    expect(isHubPublished(published)).toBe(true);
    expect(() => resolveCorsOrigin(undefined, published)).toThrow(
      /HUB_LISTEN/,
    );
    expect(() => resolveCorsOrigin("*", published)).toThrow(/HUB_LISTEN/);
    expect(resolveCorsOrigin("https://app.example", published)).toBe(
      "https://app.example",
    );
  });

  test("loopback hosts are recognised", () => {
    for (const h of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]"]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    for (const h of ["0.0.0.0", "192.168.1.5", "example.com", "::", ""]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });

  test("dev accepts a comma-separated list", () => {
    expect(
      resolveCorsOrigin("http://127.0.0.1:4321, https://hub.example", {}),
    ).toEqual(["http://127.0.0.1:4321", "https://hub.example"]);
  });

  test("production rejects * and unset", () => {
    const prod = { HUB_ENV: "production" };
    expect(() => resolveCorsOrigin(undefined, prod)).toThrow(/CORS_ORIGIN/);
    expect(() => resolveCorsOrigin("*", prod)).toThrow(/CORS_ORIGIN/);
    expect(() => resolveCorsOrigin("*,http://127.0.0.1:4321", prod)).toThrow(
      /CORS_ORIGIN/,
    );
  });

  test("production accepts an explicit origin", () => {
    expect(
      resolveCorsOrigin("http://127.0.0.1:4321", { HUB_ENV: "production" }),
    ).toBe("http://127.0.0.1:4321");
  });
});
