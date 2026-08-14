import { describe, expect, test } from "bun:test";
import { DEFAULT_HUB_URL, resolveHubBaseUrl } from "./hubUrl";

describe("resolveHubBaseUrl", () => {
  test("defaults to localhost:4322", () => {
    expect(resolveHubBaseUrl(undefined)).toBe(DEFAULT_HUB_URL);
    expect(resolveHubBaseUrl("")).toBe(DEFAULT_HUB_URL);
    expect(resolveHubBaseUrl("   ")).toBe(DEFAULT_HUB_URL);
  });

  test("trims trailing slash", () => {
    expect(resolveHubBaseUrl("https://hub.example/")).toBe(
      "https://hub.example",
    );
  });
});
