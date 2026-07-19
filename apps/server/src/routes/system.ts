import { Elysia, t } from "elysia";
import { count, desc, eq } from "drizzle-orm";
import { beatmaps, imports, scores, settings } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";

/** Written by the web UI; read by realm-reader to avoid opening client.realm while unfocused. */
export const SYNC_UI_FOCUSED_KEY = "sync.ui_focused";

export const systemRoutes = new Elysia({ prefix: "/system" })
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

    return {
      beatmapCount: beatmapCount?.n ?? 0,
      scoreCount: scoreCount?.n ?? 0,
      /** Explicit false means the web UI asked realm-reader to pause Realm opens. */
      syncPaused: focusRow?.value === "0",
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
