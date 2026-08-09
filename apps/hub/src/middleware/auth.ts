import Elysia, { t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { bearer } from "@elysiajs/bearer";

export interface JwtPayload {
  sub: number;       // hub user id
  osuId: number;
  username: string;
  role: "user" | "admin";
}

/**
 * Base JWT plugin — shared by all auth guards.
 * Import this wherever you need to sign or verify tokens.
 */
export const jwtPlugin = new Elysia({ name: "jwt" }).use(
  jwt({
    name: "jwt",
    secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
    exp: "30d",
  })
);

/**
 * Requires a valid JWT Bearer token.
 * Adds `user: JwtPayload` to the context.
 */
export const requireAuth = new Elysia({ name: "requireAuth" })
  .use(jwtPlugin)
  .use(bearer())
  .derive({ as: "scoped" }, async ({ jwt, bearer, error }) => {
    if (!bearer) return error(401, { message: "Missing authorization token" });

    const payload = await jwt.verify(bearer);
    if (!payload) return error(401, { message: "Invalid or expired token" });

    return { user: payload as unknown as JwtPayload };
  });

/**
 * Requires a valid JWT Bearer token AND admin role.
 */
export const requireAdmin = new Elysia({ name: "requireAdmin" })
  .use(requireAuth)
  .derive({ as: "scoped" }, ({ user, error }) => {
    if (user.role !== "admin") {
      return error(403, { message: "Admin access required" });
    }
    return {};
  });
