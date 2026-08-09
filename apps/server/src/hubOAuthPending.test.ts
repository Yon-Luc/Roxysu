import { afterEach, describe, expect, test } from "bun:test";
import {
  beginHubOAuthHandoff,
  clearAllHubOAuthHandoffs,
  clearHubOAuthHandoff,
  markHubOAuthHandoffReady,
  peekHubOAuthHandoffReady,
} from "./hubOAuthPending";

afterEach(() => {
  clearAllHubOAuthHandoffs();
});

describe("hubOAuthPending", () => {
  test("begin creates an id that is not ready until marked", () => {
    const id = beginHubOAuthHandoff();
    expect(id.length).toBeGreaterThanOrEqual(16);
    expect(peekHubOAuthHandoffReady(id)).toBe(false);
    expect(markHubOAuthHandoffReady(id)).toBe(true);
    expect(peekHubOAuthHandoffReady(id)).toBe(true);
  });

  test("cannot mark an unknown handoff ready", () => {
    expect(markHubOAuthHandoffReady("not-a-real-handoff-id-xxxxx")).toBe(
      false,
    );
  });

  test("clear removes the handoff", () => {
    const id = beginHubOAuthHandoff();
    markHubOAuthHandoffReady(id);
    clearHubOAuthHandoff(id);
    expect(peekHubOAuthHandoffReady(id)).toBe(false);
    expect(markHubOAuthHandoffReady(id)).toBe(false);
  });
});
