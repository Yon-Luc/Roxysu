import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  beginHubOAuthHandoff,
  clearAllHubOAuthHandoffs,
  clearHubOAuthHandoff,
  markHubOAuthHandoffReady,
  peekHubOAuthHandoffReady,
  verifyHubOAuthHandoffVerifier,
} from "./hubOAuthPending";

afterEach(() => {
  clearAllHubOAuthHandoffs();
});

describe("hubOAuthPending", () => {
  test("begin creates an id that is not ready until marked", () => {
    const { handoff: id } = beginHubOAuthHandoff();
    expect(id.length).toBeGreaterThanOrEqual(16);
    expect(peekHubOAuthHandoffReady(id)).toBe(false);
    expect(markHubOAuthHandoffReady(id, "hub-handoff-id-from-redirect")).toBe(true);
    expect(peekHubOAuthHandoffReady(id)).toBe(true);
  });

  test("cannot mark an unknown handoff ready", () => {
    expect(markHubOAuthHandoffReady("not-a-real-handoff-id-xxxxx", "hub-handoff-id-from-redirect")).toBe(
      false,
    );
  });

  test("clear removes the handoff", () => {
    const { handoff: id } = beginHubOAuthHandoff();
    markHubOAuthHandoffReady(id, "hub-handoff-id-from-redirect");
    clearHubOAuthHandoff(id);
    expect(peekHubOAuthHandoffReady(id)).toBe(false);
    expect(markHubOAuthHandoffReady(id, "hub-handoff-id-from-redirect")).toBe(false);
  });
});

describe("handoff verifier", () => {
  test("begin returns a high-entropy verifier and its SHA-256 challenge", () => {
    const { handoff, verifier, challenge } = beginHubOAuthHandoff();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).not.toBe(handoff);
    expect(challenge).toBe(
      createHash("sha256").update(verifier).digest("base64url"),
    );
    expect(challenge).not.toBe(verifier);
  });

  test("only the begin verifier verifies; a wrong one does not clear the handoff", () => {
    const { handoff, verifier } = beginHubOAuthHandoff();
    markHubOAuthHandoffReady(handoff, "hub-handoff-id-from-redirect");
    expect(verifyHubOAuthHandoffVerifier(handoff, verifier)).toBe(true);
    expect(verifyHubOAuthHandoffVerifier(handoff, "A".repeat(43))).toBe(false);
    expect(verifyHubOAuthHandoffVerifier(handoff, "short")).toBe(false);
    expect(verifyHubOAuthHandoffVerifier("unknown-handoff-id-xxxxxx", verifier)).toBe(
      false,
    );
    // Still redeemable by the real initiator.
    expect(peekHubOAuthHandoffReady(handoff)).toBe(true);
    expect(verifyHubOAuthHandoffVerifier(handoff, verifier)).toBe(true);
  });

  test("a verifier from another begin does not verify", () => {
    const a = beginHubOAuthHandoff();
    const b = beginHubOAuthHandoff();
    expect(verifyHubOAuthHandoffVerifier(a.handoff, b.verifier)).toBe(false);
  });
});
