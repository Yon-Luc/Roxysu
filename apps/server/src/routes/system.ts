import { Elysia } from "elysia";
import { count, desc } from "drizzle-orm";
import { beatmaps, imports, scores } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";

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

    return {
      beatmapCount: beatmapCount?.n ?? 0,
      scoreCount: scoreCount?.n ?? 0,
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
            error: lastImport.error,
          }
        : null,
    };
  });
