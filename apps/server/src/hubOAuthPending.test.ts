import { afterEach, describe, expect, test } from "bun:test";
import {
  clearPendingHubOAuthToken,
  setPendingHubOAuthToken,
  takePendingHubOAuthToken,
} from "./hubOAuthPending";

afterEach(() => {
  clearPendingHubOAuthToken();
});

describe("hubOAuthPending", () => {
  test("stores and consumes a token once", () => {
    setPendingHubOAuthToken("jwt-1");
    expect(takePendingHubOAuthToken()).toBe("jwt-1");
    expect(takePendingHubOAuthToken()).toBeNull();
  });

  test("ignores empty tokens", () => {
    setPendingHubOAuthToken("  ");
    expect(takePendingHubOAuthToken()).toBeNull();
  });

  test("overwrite keeps the latest token", () => {
    setPendingHubOAuthToken("old");
    setPendingHubOAuthToken("new");
    expect(takePendingHubOAuthToken()).toBe("new");
  });
});
