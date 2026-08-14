import { describe, expect, test } from "bun:test";
import {
  DEFAULT_HUB_URL,
  PRODUCTION_HUB_URL,
  resolveHubBaseUrl,
} from "./hubUrl";

describe("resolveHubBaseUrl", () => {
  test("defaults to localhost:4322", () => {
    expect(resolveHubBaseUrl(undefined, {})).toBe(DEFAULT_HUB_URL);
    expect(resolveHubBaseUrl("", {})).toBe(DEFAULT_HUB_URL);
    expect(resolveHubBaseUrl("   ", {})).toBe(DEFAULT_HUB_URL);
  });

  test("desktop defaults to the public Hub", () => {
    expect(resolveHubBaseUrl(undefined, { ROXYSU_DESKTOP: "1" })).toBe(
      PRODUCTION_HUB_URL,
    );
  });

  test("HUB_URL wins over the desktop default", () => {
    expect(
      resolveHubBaseUrl("http://localhost:4322/", { ROXYSU_DESKTOP: "1" }),
    ).toBe("http://localhost:4322");
  });

  test("trims trailing slash", () => {
    expect(resolveHubBaseUrl("https://hub.example/")).toBe(
      "https://hub.example",
    );
  });
});
