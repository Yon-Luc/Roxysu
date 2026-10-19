import { afterEach, describe, expect, test } from "bun:test";
import {
  clearCachedJwtSecret,
  resolveJwtSecret,
} from "./jwtSecret";
import {
  clearOAuthStateStore,
  consumeHandoff,
  consumeOAuthState,
  createHandoff,
  createOAuthState,
  handoffChallengeFor,
  isValidHandoffChallenge,
} from "./oauthState";
import { allowRateLimit, clearRateLimitBuckets } from "./rateLimit";

afterEach(() => {
  clearCachedJwtSecret();
  clearOAuthStateStore();
  clearRateLimitBuckets();
  delete process.env.JWT_SECRET;
  delete process.env.HUB_ALLOW_INSECURE_JWT;
  delete process.env.HUB_ENV;
  delete process.env.NODE_ENV;
});

describe("resolveJwtSecret", () => {
  test("accepts a strong secret", () => {
    process.env.JWT_SECRET = "a".repeat(32);
    expect(resolveJwtSecret()).toBe("a".repeat(32));
  });

  test("rejects change-me* placeholders even if long", () => {
    process.env.HUB_ENV = "production";
    process.env.JWT_SECRET = `change-me-${"x".repeat(40)}`;
    expect(() => resolveJwtSecret()).toThrow(/JWT_SECRET/);
  });

  test("allows ephemeral secret when opted in", () => {
    process.env.HUB_ALLOW_INSECURE_JWT = "1";
    const a = resolveJwtSecret();
    const b = resolveJwtSecret();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).toBe(b);
  });
});

describe("oauthState", () => {
  const VERIFIER = "v".repeat(43);
  const CHALLENGE = handoffChallengeFor(VERIFIER);

  test("challenge is a 43-char base64url SHA-256", () => {
    expect(isValidHandoffChallenge(CHALLENGE)).toBe(true);
    expect(CHALLENGE).not.toBe(VERIFIER);
    expect(isValidHandoffChallenge("short")).toBe(false);
    expect(isValidHandoffChallenge(undefined)).toBe(false);
  });

  test("state is one-time and binds client + handoff + challenge", () => {
    const state = createOAuthState("desktop", "handoff-id-1234567890ab", CHALLENGE);
    const entry = consumeOAuthState(state);
    expect(entry?.client).toBe("desktop");
    expect(entry?.handoffId).toBe("handoff-id-1234567890ab");
    expect(entry?.challenge).toBe(CHALLENGE);
    expect(consumeOAuthState(state)).toBeNull();
  });

  test("state refuses a malformed challenge", () => {
    expect(() => createOAuthState("web", null, "nope")).toThrow(/challenge/);
  });

  test("handoff is one-time and needs the verifier", () => {
    const id = createHandoff("jwt-token", null, CHALLENGE);
    expect(consumeHandoff(id, VERIFIER)).toBe("jwt-token");
    expect(consumeHandoff(id, VERIFIER)).toBeNull();
  });

  test("wrong, missing, or malformed verifier does not redeem or consume", () => {
    const id = createHandoff("jwt-token", null, CHALLENGE);
    expect(consumeHandoff(id, "w".repeat(43))).toBeNull();
    expect(consumeHandoff(id, undefined)).toBeNull();
    expect(consumeHandoff(id, "short")).toBeNull();
    expect(consumeHandoff(id, CHALLENGE)).toBeNull();
    expect(consumeHandoff(id, VERIFIER)).toBe("jwt-token");
  });

  test("preferred handoff id is reused when free", () => {
    const preferred = "preferred-handoff-id-xyz";
    const id = createHandoff("jwt-token", preferred, CHALLENGE);
    expect(id).toBe(preferred);
    expect(consumeHandoff(preferred, VERIFIER)).toBe("jwt-token");
  });
});

describe("allowRateLimit", () => {
  test("blocks after limit", () => {
    expect(allowRateLimit("k", { limit: 2, windowMs: 60_000 })).toBe(true);
    expect(allowRateLimit("k", { limit: 2, windowMs: 60_000 })).toBe(true);
    expect(allowRateLimit("k", { limit: 2, windowMs: 60_000 })).toBe(false);
  });
});
