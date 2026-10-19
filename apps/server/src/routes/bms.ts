import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { beatmaps } from "@roxysu/db/schema";
import {
  BMS_AUTO_UPLOAD_KEY,
  BMS_BACKFILL_STATUS_KEY,
  BMS_HISTORICAL_UPLOAD_KEY,
  BMS_HUB_JWT_KEY,
  BMS_SYNC_AUTH_PAUSED_KEY,
  BMS_TABLE_REFRESH_AT_KEY,
} from "@roxysu/db/settings-keys";
import { dbPlugin } from "../db-runtime";
import { resolveHubBaseUrl } from "../hubUrl";
import { deriveBmsScores } from "../bms/derive";
import {
  listLocalScores,
  listLocalSessions,
  localBmsOverview,
  localTableCompletion,
  replaceTableCache,
  seedBundledLocalTables,
} from "../bms/localProfile";
import { deleteSetting, readSetting, writeSetting } from "../bms/settings";
import { resolveBmsStageImage, sniffStageMime } from "../bms/stageImage";
import { getOsuDataPath } from "../shared/osu-paths";
import {
  bmsSyncStatus,
  drainBmsQueue,
  enqueueHistoricalPage,
  postBmsBatch,
  retryWaiting,
} from "../bms/sync";

const TABLE_REFRESH_MS = 15 * 60 * 1000;
let tableRefreshInFlight: Promise<void> | null = null;

async function refreshTableCache(db: Parameters<typeof replaceTableCache>[0]) {
  const base = resolveHubBaseUrl();
  const catalogue = await fetch(`${base}/api/bms/tables`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!catalogue.ok) return;
  const body = (await catalogue.json()) as {
    tables?: Array<{ id: string; latestVersionId: string | null }>;
  };
  for (const table of body.tables ?? []) {
    if (!table.latestVersionId) continue;
    const res = await fetch(
      `${base}/api/bms/tables/${encodeURIComponent(table.id)}/versions/${encodeURIComponent(table.latestVersionId)}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) continue;
    const version = (await res.json()) as {
      versionId: string;
      tableId: string;
      name: string;
      symbol: string;
      sourceUrl: string;
      importedAt: string;
      levelOrder: string[];
      entries: Array<{
        level: string;
        levelIndex: number;
        md5: string | null;
        sha256: string | null;
      }>;
      unresolvedCount: number;
    };
    await replaceTableCache(db, {
      ...version,
      importedAt: Date.parse(version.importedAt) || Date.now(),
    });
  }
}

function scheduleTableRefresh(
  db: Parameters<typeof replaceTableCache>[0],
  force: boolean,
) {
  if (tableRefreshInFlight) return;
  tableRefreshInFlight = (async () => {
    try {
      if (!force) {
        const last = Number((await readSetting(db, BMS_TABLE_REFRESH_AT_KEY)) ?? "0");
        if (Number.isFinite(last) && Date.now() - last < TABLE_REFRESH_MS) return;
      }
      await writeSetting(db, BMS_TABLE_REFRESH_AT_KEY, String(Date.now()));
      await refreshTableCache(db);
    } catch {
      // The next interval tries again. The response already used the cache.
    }
  })().finally(() => {
    tableRefreshInFlight = null;
  });
}

export function bmsTableRefreshInFlight(): Promise<void> | null {
  return tableRefreshInFlight;
}

export const bmsRoutes = new Elysia({ prefix: "/bms" })
  .use(dbPlugin)
  .get(
    "/covers/:beatmapId",
    async ({ db, params, set }) => {
      const row = await db
        .select({
          source: beatmaps.source,
          hash: beatmaps.hash,
          ruleset: beatmaps.rulesetShortName,
        })
        .from(beatmaps)
        .where(eq(beatmaps.id, params.beatmapId))
        .get();
      if (!row || row.ruleset !== "bms") {
        set.status = 404;
        return { error: "Cover not found" };
      }
      const filePath = resolveBmsStageImage({
        sourceDir: row.source,
        chartHash: row.hash,
        osuDataPath: getOsuDataPath(),
      });
      if (!filePath) {
        set.status = 404;
        return { error: "Cover not found" };
      }
      const handle = await open(filePath, "r");
      const head = Buffer.alloc(16);
      await handle.read(head, 0, 16, 0);
      await handle.close();
      const mime = sniffStageMime(head);
      if (!mime) {
        set.status = 415;
        return { error: "Not an image" };
      }
      set.headers["content-type"] = mime;
      set.headers["cache-control"] = "private, max-age=86400";
      return Readable.toWeb(createReadStream(filePath));
    },
    { params: t.Object({ beatmapId: t.String() }) },
  )
  .get(
    "/profile",
    async ({ db, query }) => localBmsOverview(db, query.variant ?? null),
    {
      query: t.Object({
        variant: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/scores",
    async ({ db, query }) =>
      listLocalScores(db, {
        variant: query.variant ?? null,
        limit: query.limit ?? 20,
        cursor: query.cursor,
      }),
    {
      query: t.Object({
        variant: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        cursor: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/sessions",
    async ({ db, query }) => listLocalSessions(db, query.variant ?? null),
    { query: t.Object({ variant: t.Optional(t.String()) }) },
  )
  .get(
    "/tables",
    async ({ db, query }) => {
      await seedBundledLocalTables(db);
      scheduleTableRefresh(db, query.refresh === "1");
      return {
        tables: await localTableCompletion(
          db,
          query.variant ?? "standard",
          query.achievement ?? "aa",
        ),
      };
    },
    {
      query: t.Object({
        variant: t.Optional(t.String()),
        achievement: t.Optional(t.String()),
        refresh: t.Optional(t.String()),
      }),
    },
  )
  .get("/sync", async ({ db }) => bmsSyncStatus(db))
  .patch(
    "/sync",
    async ({ db, body, set }) => {
      const enabling = body.autoUpload === true || body.historicalUpload === true;
      if (body.hubJwt === null) await deleteSetting(db, BMS_HUB_JWT_KEY);
      if (typeof body.hubJwt === "string" && body.hubJwt.length > 0) {
        await writeSetting(db, BMS_HUB_JWT_KEY, body.hubJwt);
        await deleteSetting(db, BMS_SYNC_AUTH_PAUSED_KEY);
      }
      if (enabling && (await readSetting(db, BMS_HUB_JWT_KEY)) == null) {
        set.status = 400;
        return { message: "Hub login is required before upload" };
      }
      if (body.autoUpload != null) {
        await writeSetting(db, BMS_AUTO_UPLOAD_KEY, body.autoUpload ? "1" : "0");
      }
      if (body.historicalUpload != null) {
        await writeSetting(
          db,
          BMS_HISTORICAL_UPLOAD_KEY,
          body.historicalUpload ? "1" : "0",
        );
        if (body.historicalUpload) {
          await writeSetting(db, BMS_BACKFILL_STATUS_KEY, "running");
          await deriveBmsScores(db, null);
          await enqueueHistoricalPage(db);
        }
      }
      if (body.autoUpload) await deriveBmsScores(db, null);
      const token = await readSetting(db, BMS_HUB_JWT_KEY);
      if (token && (body.autoUpload || body.historicalUpload)) {
        await drainBmsQueue(db, { post: (payload) => postBmsBatch(payload, token) });
      }
      return bmsSyncStatus(db);
    },
    {
      body: t.Object({
        autoUpload: t.Optional(t.Boolean()),
        historicalUpload: t.Optional(t.Boolean()),
        hubJwt: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )
  .post("/sync/retry", async ({ db }) => {
    const moved = await retryWaiting(db);
    const token = await readSetting(db, BMS_HUB_JWT_KEY);
    if (token) {
      await drainBmsQueue(db, {
        post: (payload) => postBmsBatch(payload, token),
        force: true,
      });
    }
    return { moved, ...(await bmsSyncStatus(db)) };
  });
