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
  test("state is one-time and binds client + handoff", () => {
    const state = createOAuthState("desktop", "handoff-id-1234567890ab");
    const entry = consumeOAuthState(state);
    expect(entry?.client).toBe("desktop");
    expect(entry?.handoffId).toBe("handoff-id-1234567890ab");
    expect(consumeOAuthState(state)).toBeNull();
  });

  test("handoff is one-time", () => {
    const id = createHandoff("jwt-token");
    expect(consumeHandoff(id)).toBe("jwt-token");
    expect(consumeHandoff(id)).toBeNull();
  });

  test("preferred handoff id is reused when free", () => {
    const preferred = "preferred-handoff-id-xyz";
    const id = createHandoff("jwt-token", preferred);
    expect(id).toBe(preferred);
    expect(consumeHandoff(preferred)).toBe("jwt-token");
  });
});

describe("allowRateLimit", () => {
  test("blocks after limit", () => {
    expect(allowRateLimit("k", { limit: 2, windowMs: 60_000 })).toBe(true);
    expect(allowRateLimit("k", { limit: 2, windowMs: 60_000 })).toBe(true);
    expect(allowRateLimit("k", { limit: 2, windowMs: 60_000 })).toBe(false);
  });
});
