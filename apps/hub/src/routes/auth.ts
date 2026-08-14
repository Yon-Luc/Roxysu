import Elysia, { status, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { hubUsers } from "@roxysu/db/hub";
import {
  buildAuthorizationUrl,
  exchangeCode,
  fetchOsuMe,
} from "../services/osu-oauth";
import {
  consumeHandoff,
  consumeOAuthState,
  createHandoff,
  createOAuthState,
} from "../services/oauthState";
import { allowRateLimit } from "../services/rateLimit";
import { clientIp } from "../services/clientIp";
import { parseAdminOsuId, resolveHubLoginRole } from "../services/hubRole";
import { jwtPlugin, requireAuth } from "../middleware/auth";

const DEFAULT_CLIENT_REDIRECT = "http://127.0.0.1:4321/#/hub-callback";
const DEFAULT_DESKTOP_REDIRECT =
  "http://127.0.0.1:4321/api/system/hub-oauth/complete";

/** Append a one-time handoff id (never the JWT) to the post-login redirect. */
function appendHandoffParam(base: string, handoffId: string): string {
  const param = `h=${encodeURIComponent(handoffId)}`;
  const hashIdx = base.indexOf("#");
  if (hashIdx >= 0) {
    const before = base.slice(0, hashIdx);
    const hash = base.slice(hashIdx + 1);
    const sep = hash.includes("?") ? "&" : "?";
    return `${before}#${hash}${sep}${param}`;
  }
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${param}`;
}

function buildClientRedirect(handoffId: string): string {
  const base =
    process.env.HUB_CLIENT_REDIRECT_URI?.trim() || DEFAULT_CLIENT_REDIRECT;
  return appendHandoffParam(base, handoffId);
}

function buildDesktopRedirect(handoffId: string): string {
  const base =
    process.env.HUB_DESKTOP_REDIRECT_URI?.trim() || DEFAULT_DESKTOP_REDIRECT;
  return appendHandoffParam(base, handoffId);
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(jwtPlugin)

  // -------------------------------------------------------------------------
  // GET /auth/login — redirect to osu! OAuth (public)
  // ?client=desktop&handoff=… → CSRF state bound to desktop handoff id
  // -------------------------------------------------------------------------
  .get(
    "/login",
    ({ query, redirect }) => {
      const client = query.client === "desktop" ? "desktop" : "web";
      const handoffId = query.handoff?.trim() || null;
      if (client === "desktop" && !handoffId) {
        return status(400, {
          message: "Desktop login requires a handoff id from Roxysu",
        });
      }
      const state = createOAuthState(client, handoffId);
      return redirect(buildAuthorizationUrl(state));
    },
    {
      query: t.Object({
        client: t.Optional(t.String()),
        /** Desktop: opaque id from POST /api/system/hub-oauth/begin */
        handoff: t.Optional(t.String({ minLength: 16, maxLength: 128 })),
      }),
    },
  )

  // -------------------------------------------------------------------------
  // GET /auth/callback — exchange code, upsert user, redirect with handoff id
  // -------------------------------------------------------------------------
  .get(
    "/callback",
    async ({ query, jwt, redirect }) => {
      if (query.error) {
        return status(400, { message: `OAuth error: ${query.error}` });
      }

      const stateEntry = consumeOAuthState(query.state);
      if (!stateEntry) {
        return status(400, { message: "Invalid or expired OAuth state" });
      }

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

      const existing = await db
        .select()
        .from(hubUsers)
        .where(eq(hubUsers.osuId, osuUser.id))
        .get();

      const role = resolveHubLoginRole({
        osuId: osuUser.id,
        existingRole: existing?.role,
        adminOsuId: parseAdminOsuId(process.env.ADMIN_OSU_ID),
      });

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

      const handoffId = createHandoff(token, stateEntry.handoffId);

      if (stateEntry.client === "desktop") {
        return redirect(buildDesktopRedirect(handoffId));
      }
      return redirect(buildClientRedirect(handoffId));
    },
    {
      query: t.Object({
        code: t.Optional(t.String()),
        state: t.Optional(t.String()),
        // osu! may send ?error=access_denied — keep as oauthError to avoid
        // clashing with response helpers named `error`/`status`.
        error: t.Optional(t.String()),
      }),
    },
  )

  // -------------------------------------------------------------------------
  // GET /auth/handoff/:id — one-time JWT redeem (short TTL; rate limited)
  // -------------------------------------------------------------------------
  .get(
    "/handoff/:id",
    ({ params, request, server, set }) => {
      const ip = clientIp(request, server);
      if (!allowRateLimit(`handoff:${ip}`, { limit: 30, windowMs: 60_000 })) {
        set.status = 429;
        return { message: "Too many handoff attempts" };
      }

      const token = consumeHandoff(params.id);
      if (!token) {
        set.status = 404;
        return { message: "Handoff expired or already used" };
      }

      set.headers["cache-control"] = "no-store";
      return { token };
    },
    {
      params: t.Object({
        id: t.String({ minLength: 16, maxLength: 128 }),
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
