import { beatmaps, imports, scores, settings } from "@roxysu/db/schema";
import { Elysia, t } from "elysia";
import { count, desc, eq } from "drizzle-orm";

import {
  SYNC_PAUSE_WHEN_UNFOCUSED_KEY,
  SYNC_UI_FOCUSED_KEY,
} from "@roxysu/db/settings-keys";
import { dbPlugin } from "../db-runtime";
import {
  beginHubOAuthHandoff,
  clearHubOAuthHandoff,
  markHubOAuthHandoffReady,
  peekHubOAuthHandoffReady,
} from "../hubOAuthPending";
import { resolveHubBaseUrl } from "../hubUrl";

export { SYNC_PAUSE_WHEN_UNFOCUSED_KEY, SYNC_UI_FOCUSED_KEY };

const HUB_OAUTH_DONE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signed in — Roxysu</title>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: #12141a;
      color: #e8eaef;
    }
    main { text-align: center; padding: 2rem; max-width: 28rem; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { margin: 0; color: #9aa3b5; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <h1>Signed in to Roxysu Workshop</h1>
    <p>You can close this tab and return to the app.</p>
  </main>
</body>
</html>`;

function hubBaseUrl(): string {
  return resolveHubBaseUrl();
}

export const systemRoutes = new Elysia({ prefix: "/system" })
  .get("/healthz", () => ({ ok: true }))
  // -------------------------------------------------------------------------
  // Hub OAuth handoff (Electron system-browser flow)
  // 1) POST /begin → handoff id
  // 2) Open hub /auth/login?client=desktop&handoff=…
  // 3) Browser lands on /complete?h=… (no JWT in URL)
  // 4) UI polls /pending?h=… → server redeems JWT from hub once
  // -------------------------------------------------------------------------
  .post("/hub-oauth/begin", ({ set }) => {
    set.headers["cache-control"] = "no-store";
    return { handoff: beginHubOAuthHandoff() };
  })
  .get(
    "/hub-oauth/complete",
    ({ query }) => {
      const handoff = query.h?.trim();
      if (!handoff) {
        return new Response("Missing handoff id", {
          status: 400,
          headers: {
            "Content-Type": "text/plain;charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
      if (!markHubOAuthHandoffReady(handoff)) {
        return new Response("Unknown or expired handoff", {
          status: 400,
          headers: {
            "Content-Type": "text/plain;charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
      return new Response(HUB_OAUTH_DONE_HTML, {
        status: 200,
        headers: {
          "Content-Type": "text/html;charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    },
    {
      query: t.Object({
        h: t.Optional(t.String({ minLength: 16, maxLength: 128 })),
      }),
    },
  )
  .get(
    "/hub-oauth/pending",
    async ({ query, set }) => {
      set.headers["cache-control"] = "no-store";
      const handoff = query.h?.trim();
      if (!handoff) {
        set.status = 400;
        return { error: "Missing handoff id", token: null };
      }
      if (!peekHubOAuthHandoffReady(handoff)) {
        return { token: null };
      }

      try {
        const res = await fetch(
          `${hubBaseUrl()}/auth/handoff/${encodeURIComponent(handoff)}`,
          {
            headers: { accept: "application/json" },
            cache: "no-store",
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          token?: string;
          message?: string;
        };
        if (!res.ok || !data.token) {
          if (res.status === 404) clearHubOAuthHandoff(handoff);
          return { token: null };
        }
        clearHubOAuthHandoff(handoff);
        return { token: data.token };
      } catch {
        return { token: null };
      }
    },
    {
      query: t.Object({
        h: t.Optional(t.String({ minLength: 16, maxLength: 128 })),
      }),
    },
  )
  .use(dbPlugin)
  .get("/status", async ({ db }) => {
    const [beatmapCount] = await db.select({ n: count() }).from(beatmaps);
    const [scoreCount] = await db.select({ n: count() }).from(scores);
    const [lastImport] = await db
      .select()
      .from(imports)
      .orderBy(desc(imports.id))
      .limit(1);
    const [focusRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SYNC_UI_FOCUSED_KEY))
      .limit(1);
    const [pauseWhenUnfocusedRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SYNC_PAUSE_WHEN_UNFOCUSED_KEY))
      .limit(1);

    return {
      beatmapCount: beatmapCount?.n ?? 0,
      scoreCount: scoreCount?.n ?? 0,
      /** Public hub base URL for collection sharing / search cache. */
      hubUrl: resolveHubBaseUrl(),
      /** True only when pause-when-unfocused is enabled and the web UI reported unfocused. */
      syncPaused:
        pauseWhenUnfocusedRow?.value === "1" && focusRow?.value === "0",
      lastImport: lastImport
        ? {
            id: lastImport.id,
            kind: lastImport.kind,
            status: lastImport.status,
            startedAt: toIso(lastImport.startedAt),
            finishedAt: toIso(lastImport.finishedAt),
            realmSchemaVersion: lastImport.realmSchemaVersion,
            beatmapSetsUpserted: lastImport.beatmapSetsUpserted,
            beatmapsUpserted: lastImport.beatmapsUpserted,
            scoresUpserted: lastImport.scoresUpserted,
            rowsChanged: lastImport.rowsChanged,
            scoresDeleted: lastImport.scoresDeleted,
            beatmapsDeleted: lastImport.beatmapsDeleted,
            beatmapSetsDeleted: lastImport.beatmapSetsDeleted,
            error: lastImport.error,
          }
        : null,
    };
  })
  .post(
    "/sync-focus",
    async ({ db, body }) => {
      const value = body.focused ? "1" : "0";
      await db
        .insert(settings)
        .values({ key: SYNC_UI_FOCUSED_KEY, value })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value },
        });
      return { focused: body.focused };
    },
    {
      body: t.Object({
        focused: t.Boolean(),
      }),
    },
  );
