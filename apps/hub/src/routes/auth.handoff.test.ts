import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import Elysia from "elysia";
import { clearCachedJwtSecret } from "../services/jwtSecret";
import { clearRateLimitBuckets } from "../services/rateLimit";
import {
  clearOAuthStateStore,
  createHandoff,
  handoffChallengeFor,
} from "../services/oauthState";

/**
 * F-057: the Hub OAuth handoff is redeemed with POST and needs the verifier
 * whose SHA-256 was registered at /auth/login. Knowing the id is not enough.
 */
describe("auth handoff routes", () => {
  let app: Elysia;
  const VERIFIER = "r".repeat(43);
  const CHALLENGE = handoffChallengeFor(VERIFIER);

  beforeAll(async () => {
    process.env.JWT_SECRET = "t".repeat(40);
    process.env.DATABASE_URL = ":memory:";
    const { authRoutes } = await import("./auth");
    app = new Elysia()
      .onError(({ code, set }) => {
        if (code === "VALIDATION") {
          set.status = 400;
          return { message: "Validation error" };
        }
      })
      .use(authRoutes) as unknown as Elysia;
  });

  afterEach(() => {
    clearOAuthStateStore();
    clearRateLimitBuckets();
  });

  afterAll(() => {
    clearCachedJwtSecret();
    delete process.env.JWT_SECRET;
  });

  function redeem(id: string, verifier?: string) {
    return app.handle(
      new Request(`http://localhost/auth/handoff/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(verifier === undefined ? {} : { verifier }),
      }),
    );
  }

  test("GET redeem is gone", async () => {
    const id = createHandoff("jwt", CHALLENGE);
    const res = await app.handle(new Request(`http://localhost/auth/handoff/${id}`));
    expect(res.status).toBe(404);
    expect((await redeem(id, VERIFIER)).status).toBe(200);
  });

  test("redeem without or with a wrong verifier fails and keeps the handoff", async () => {
    const id = createHandoff("jwt", CHALLENGE);
    expect((await redeem(id)).status).toBe(400);
    expect((await redeem(id, "x".repeat(43))).status).toBe(404);
    const ok = await redeem(id, VERIFIER);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ token: "jwt" });
    expect((await redeem(id, VERIFIER)).status).toBe(404);
  });

  test("wrong-verifier attempts count toward the rate limit", async () => {
    const id = createHandoff("jwt", CHALLENGE);
    for (let i = 0; i < 30; i++) await redeem(id, "x".repeat(43));
    expect((await redeem(id, VERIFIER)).status).toBe(429);
  });

  test("login requires a challenge", async () => {
    const res = await app.handle(new Request("http://localhost/auth/login"));
    expect(res.status).toBe(400);
  });
});
