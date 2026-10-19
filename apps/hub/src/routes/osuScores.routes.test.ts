import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import Elysia from "elysia";
import { clearCachedJwtSecret } from "../services/jwtSecret";

/**
 * F-023: the osu! usage ledger is admin-only. There must be no user-role
 * `/osu/budget` route, and `/admin/osu-budget` must reject anonymous callers.
 * Requests carry no Bearer token, so auth fails before any query runs.
 */
describe("osu score routes access", () => {
  let app: Elysia;

  beforeAll(async () => {
    process.env.JWT_SECRET = "t".repeat(40);
    process.env.DATABASE_URL = ":memory:";
    const { osuBudgetAdminRoutes, osuScoreRoutes } = await import("./osuScores");
    app = new Elysia().use(osuScoreRoutes).use(osuBudgetAdminRoutes) as unknown as Elysia;
  });

  afterAll(() => {
    clearCachedJwtSecret();
    delete process.env.JWT_SECRET;
  });

  test("GET /osu/budget is not a route", async () => {
    const res = await app.handle(new Request("http://localhost/osu/budget"));
    expect(res.status).toBe(404);
  });

  test("GET /admin/osu-budget rejects requests without a token", async () => {
    const res = await app.handle(new Request("http://localhost/admin/osu-budget"));
    expect(res.status).toBe(401);
  });

  test("GET /osu/scores/progress still requires auth", async () => {
    const res = await app.handle(
      new Request("http://localhost/osu/scores/progress?ruleset=mania"),
    );
    expect(res.status).toBe(401);
  });
});
