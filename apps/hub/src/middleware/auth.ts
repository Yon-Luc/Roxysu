import Elysia, { status } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { bearer } from "@elysiajs/bearer";
import { eq } from "drizzle-orm";
import { hubUsers } from "@roxysu/db/hub";
import { db } from "../db";
import { resolveJwtSecret } from "../services/jwtSecret";

export interface JwtPayload {
  sub: number; // hub user id
  osuId: number;
  username: string;
  role: "user" | "admin";
}

function asJwtPayload(payload: Record<string, unknown>): JwtPayload | null {
  const sub = Number(payload.sub);
  const osuId = Number(payload.osuId);
  const username = payload.username;
  const role = payload.role;
  if (!Number.isFinite(sub) || !Number.isFinite(osuId)) return null;
  if (typeof username !== "string") return null;
  if (role !== "user" && role !== "admin") return null;
  return { sub, osuId, username, role };
}

/** Best-effort parse of an optional Bearer JWT for public routes. */
export async function optionalViewerUserId(
  jwt: { verify: (token: string) => Promise<unknown> },
  bearer: string | undefined,
): Promise<number | undefined> {
  if (!bearer) return undefined;
  const payload = await jwt.verify(bearer);
  if (!payload || typeof payload !== "object") return undefined;
  return asJwtPayload(payload as Record<string, unknown>)?.sub;
}

/**
 * Base JWT plugin — shared by all auth guards.
 * Import this wherever you need to sign or verify tokens.
 */
export const jwtPlugin = new Elysia({ name: "jwt" }).use(
  jwt({
    name: "jwt",
    secret: resolveJwtSecret(),
    exp: "30d",
  }),
);

/**
 * Requires a valid JWT Bearer token.
 * Adds `user: JwtPayload` to the context — role is always re-read from DB.
 */
export const requireAuth = new Elysia({ name: "requireAuth" })
  .use(jwtPlugin)
  .use(bearer())
  .derive({ as: "scoped" }, async ({ jwt, bearer }) => {
    if (!bearer) {
      throw status(401, { message: "Missing authorization token" });
    }

    const payload = await jwt.verify(bearer);
    if (!payload || typeof payload !== "object") {
      throw status(401, { message: "Invalid or expired token" });
    }

    const claims = asJwtPayload(payload as Record<string, unknown>);
    if (!claims) {
      throw status(401, { message: "Invalid or expired token" });
    }

    const row = await db
      .select({
        id: hubUsers.id,
        osuId: hubUsers.osuId,
        username: hubUsers.username,
        role: hubUsers.role,
      })
      .from(hubUsers)
      .where(eq(hubUsers.id, claims.sub))
      .get();

    if (!row) {
      throw status(401, { message: "Invalid or expired token" });
    }

    const role = row.role === "admin" ? "admin" : "user";
    const user: JwtPayload = {
      sub: row.id,
      osuId: row.osuId,
      username: row.username,
      role,
    };

    return { user };
  });

/**
 * Requires a valid JWT Bearer token AND admin role (from DB via requireAuth).
 */
export const requireAdmin = new Elysia({ name: "requireAdmin" })
  .use(requireAuth)
  .derive({ as: "scoped" }, ({ user }) => {
    if (!user || user.role !== "admin") {
      throw status(403, { message: "Admin access required" });
    }
    return {};
  });
