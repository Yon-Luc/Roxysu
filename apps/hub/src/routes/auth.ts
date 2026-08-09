import Elysia, { status, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { hubUsers } from "@roxysu/db/hub";
import {
  buildAuthorizationUrl,
  exchangeCode,
  fetchOsuMe,
} from "../services/osu-oauth";
import { jwtPlugin, requireAuth } from "../middleware/auth";

const DEFAULT_CLIENT_REDIRECT = "http://127.0.0.1:4321/#/hub-callback";

function buildClientRedirect(token: string): string {
  const base =
    process.env.HUB_CLIENT_REDIRECT_URI?.trim() || DEFAULT_CLIENT_REDIRECT;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(jwtPlugin)

  // -------------------------------------------------------------------------
  // GET /auth/login — redirect to osu! OAuth (public)
  // -------------------------------------------------------------------------
  .get("/login", ({ redirect }) => {
    return redirect(buildAuthorizationUrl());
  })

  // -------------------------------------------------------------------------
  // GET /auth/callback — exchange code, upsert user, redirect with JWT
  // -------------------------------------------------------------------------
  .get(
    "/callback",
    async ({ query, jwt, redirect }) => {
      const { code } = query;
      if (!code) return status(400, { message: "Missing code parameter" });

      let accessToken: string;
      try {
        accessToken = await exchangeCode(code);
      } catch {
        return status(502, { message: "Failed to exchange code with osu!" });
      }

      let osuUser: Awaited<ReturnType<typeof fetchOsuMe>>;
      try {
        osuUser = await fetchOsuMe(accessToken);
      } catch {
        return status(502, { message: "Failed to fetch osu! profile" });
      }

      const adminOsuId = process.env.ADMIN_OSU_ID
        ? parseInt(process.env.ADMIN_OSU_ID, 10)
        : null;
      const role = adminOsuId && osuUser.id === adminOsuId ? "admin" : "user";

      const existing = await db
        .select()
        .from(hubUsers)
        .where(eq(hubUsers.osuId, osuUser.id))
        .get();

      let userId: number;

      if (existing) {
        await db
          .update(hubUsers)
          .set({
            username: osuUser.username,
            avatarUrl: osuUser.avatar_url,
            role,
          })
          .where(eq(hubUsers.osuId, osuUser.id));
        userId = existing.id;
      } else {
        const inserted = await db
          .insert(hubUsers)
          .values({
            osuId: osuUser.id,
            username: osuUser.username,
            avatarUrl: osuUser.avatar_url,
            role,
          })
          .returning({ id: hubUsers.id })
          .get();
        userId = inserted.id;
      }

      const token = await jwt.sign({
        // JWT `sub` is a string claim; we coerce back to number in requireAuth.
        sub: String(userId),
        osuId: osuUser.id,
        username: osuUser.username,
        role,
      });

      if (!token) {
        return status(500, { message: "Failed to issue session token" });
      }

      return redirect(buildClientRedirect(token));
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        // osu! may send ?error=access_denied — keep as oauthError to avoid
        // clashing with response helpers named `error`/`status`.
        error: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------------------------
  // GET /auth/me — current user info (JWT required)
  // -------------------------------------------------------------------------
  .use(requireAuth)
  .get("/me", async ({ user }) => {
    const row = await db
      .select()
      .from(hubUsers)
      .where(eq(hubUsers.id, user.sub))
      .get();

    if (!row) return status(404, { message: "User not found" });

    return {
      id: row.id,
      osuId: row.osuId,
      username: row.username,
      avatarUrl: row.avatarUrl,
      role: row.role,
      createdAt: row.createdAt,
    };
  });
