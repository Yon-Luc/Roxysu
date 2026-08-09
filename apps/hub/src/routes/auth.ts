import Elysia, { t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { hubUsers } from "../../../../packages/db/src/hub/schema";
import { buildAuthorizationUrl, exchangeCode, fetchOsuMe } from "../services/osu-oauth";
import { jwtPlugin, requireAuth } from "../middleware/auth";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(jwtPlugin)
  .use(requireAuth)

  // -------------------------------------------------------------------------
  // GET /auth/login — redirect to osu! OAuth
  // -------------------------------------------------------------------------
  .get("/login", ({ redirect }) => {
    return redirect(buildAuthorizationUrl());
  })

  // -------------------------------------------------------------------------
  // GET /auth/callback — exchange code, upsert user, return JWT
  // -------------------------------------------------------------------------
  .get(
    "/callback",
    async ({ query, jwt, error }) => {
      const { code } = query;
      if (!code) return error(400, { message: "Missing code parameter" });

      // 1. Exchange code for osu! access token
      let accessToken: string;
      try {
        accessToken = await exchangeCode(code);
      } catch (e) {
        return error(502, { message: "Failed to exchange code with osu!" });
      }

      // 2. Fetch osu! user profile
      let osuUser: Awaited<ReturnType<typeof fetchOsuMe>>;
      try {
        osuUser = await fetchOsuMe(accessToken);
      } catch (e) {
        return error(502, { message: "Failed to fetch osu! profile" });
      }

      // 3. Determine role — ADMIN_OSU_ID env grants admin on first/every login
      const adminOsuId = process.env.ADMIN_OSU_ID
        ? parseInt(process.env.ADMIN_OSU_ID, 10)
        : null;
      const role = adminOsuId && osuUser.id === adminOsuId ? "admin" : "user";

      // 4. Upsert user row
      const existing = await db
        .select()
        .from(hubUsers)
        .where(eq(hubUsers.osuId, osuUser.id))
        .get();

      let userId: number;

      if (existing) {
        // Update username/avatar in case they changed on osu!
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

      // 5. Issue hub JWT — osu! token is discarded after this point
      const token = await jwt.sign({
        sub: userId,
        osuId: osuUser.id,
        username: osuUser.username,
        role,
      });

      return { token };
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        error: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------------------------
  // GET /auth/me — current user info
  // -------------------------------------------------------------------------
  .get("/me", async ({ user, error }) => {
    const row = await db
      .select()
      .from(hubUsers)
      .where(eq(hubUsers.id, user.sub))
      .get();

    if (!row) return error(404, { message: "User not found" });

    return {
      id: row.id,
      osuId: row.osuId,
      username: row.username,
      avatarUrl: row.avatarUrl,
      role: row.role,
      createdAt: row.createdAt,
    };
  });
