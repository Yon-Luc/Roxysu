import { describe, expect, test } from "bun:test";
import Elysia, { status } from "elysia";

/**
 * Regression: named `requireAuth` is a singleton. When `/auth/me` mounts it
 * first, a nested admin guard must lift scope so auth still runs on
 * `/admin/*` — otherwise admins get 403 with `user === undefined`.
 */
describe("requireAdmin composition", () => {
  const requireAuth = new Elysia({ name: "requireAuthTest" }).derive(
    { as: "scoped" },
    () => ({
      user: {
        sub: 1,
        osuId: 36810767,
        username: "admin",
        role: "admin" as const,
      },
    }),
  );

  test("nested scoped derive without as(scoped) rejects real admins", async () => {
    const requireAdminBroken = new Elysia({ name: "requireAdminBroken" })
      .use(requireAuth)
      .derive({ as: "scoped" }, ({ user }) => {
        if (!user || user.role !== "admin") {
          throw status(403, { message: "Admin access required" });
        }
        return {};
      });

    const app = new Elysia()
      .use(
        new Elysia({ prefix: "/auth" })
          .use(requireAuth)
          .get("/me", ({ user }) => ({ role: user.role })),
      )
      .use(
        new Elysia({ prefix: "/admin" })
          .use(requireAdminBroken)
          .get("/cache", ({ user }) => ({ role: user?.role ?? null })),
      );

    const me = await app.handle(new Request("http://localhost/auth/me"));
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ role: "admin" });

    const cache = await app.handle(
      new Request("http://localhost/admin/cache"),
    );
    expect(cache.status).toBe(403);
  });

  test("as(scoped) + onBeforeHandle keeps admin access", async () => {
    const requireAdminFixed = new Elysia({ name: "requireAdminFixed" })
      .use(requireAuth)
      .as("scoped")
      .onBeforeHandle({ as: "scoped" }, ({ user }) => {
        if (!user || user.role !== "admin") {
          return status(403, { message: "Admin access required" });
        }
      });

    const app = new Elysia()
      .use(
        new Elysia({ prefix: "/auth" })
          .use(requireAuth)
          .get("/me", ({ user }) => ({ role: user.role })),
      )
      .use(
        new Elysia({ prefix: "/admin" })
          .use(requireAdminFixed)
          .get("/cache", ({ user }) => ({ role: user.role })),
      );

    const me = await app.handle(new Request("http://localhost/auth/me"));
    expect(me.status).toBe(200);

    const cache = await app.handle(
      new Request("http://localhost/admin/cache"),
    );
    expect(cache.status).toBe(200);
    expect(await cache.json()).toEqual({ role: "admin" });
  });
});
