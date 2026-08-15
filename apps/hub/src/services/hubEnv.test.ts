import { describe, expect, test } from "bun:test";
import {
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
  test("dev defaults to *", () => {
    expect(resolveCorsOrigin(undefined, {})).toBe("*");
    expect(resolveCorsOrigin("", {})).toBe("*");
    expect(resolveCorsOrigin("*", {})).toBe("*");
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
