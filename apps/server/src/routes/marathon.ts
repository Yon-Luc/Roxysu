import { beatmapSets, beatmaps } from "@roxysu/db/schema";
import { Elysia, t } from "elysia";
import { inArray, eq } from "drizzle-orm";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { dbPlugin } from "../db-runtime";
import {
  getOsuDataPath,
  lazerFileExists,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import { sanitizeDownloadFilename } from "../map-analysis/exportOsz";
import { ensureBeatmapsDownloadDir } from "../mirrors/downloadDir";
import { writeOsuImportScripts, openOszWithOsu } from "../mirrors/openInOsu";
import { parseOsuChart } from "@roxysu/osu-chart";

export const MARATHON_MAX_MAPS = 12;
export const MARATHON_MIN_MAPS = 2;
const OPEN_OSZ_MAX_BYTES = 250 * 1024 * 1024;

export type MarathonSource = {
  id: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  mapperUsername: string | null;
  starRating: number;
  keyCount: number | null;
  onlineId: number | null;
  setOnlineId: number | null;
  audioFileHash: string | null;
  backgroundFileHash: string | null;
  osuText: string | null;
  error: string | null;
};

function readOsuText(hash: string | null): string | null {
  if (!hash) return null;
  const filePath = resolveLazerFilePath(hash, getOsuDataPath());
  if (!filePath) return null;
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export const marathonRoutes = new Elysia({ prefix: "/marathon" })
  .use(dbPlugin)
  .post(
    "/sources",
    async ({ db, body, set }) => {
      const ids = [...new Set(body.ids.map((id) => id.trim()).filter(Boolean))];
      if (ids.length === 0) {
        set.status = 400;
        return { error: "No beatmap ids", sources: [] as MarathonSource[] };
      }
      if (ids.length > MARATHON_MAX_MAPS) {
        set.status = 400;
        return {
          error: `At most ${MARATHON_MAX_MAPS} maps`,
          sources: [] as MarathonSource[],
        };
      }

      const rows = await db
        .select({
          id: beatmaps.id,
          title: beatmaps.title,
          artist: beatmaps.artist,
          difficultyName: beatmaps.difficultyName,
          mapperUsername: beatmaps.mapperUsername,
          starRating: beatmaps.starRating,
          rulesetShortName: beatmaps.rulesetShortName,
          onlineId: beatmaps.onlineId,
          setOnlineId: beatmapSets.onlineId,
          audioFileHash: beatmaps.audioFileHash,
          backgroundFileHash: beatmaps.backgroundFileHash,
          hash: beatmaps.hash,
          hidden: beatmaps.hidden,
          setDeletePending: beatmapSets.deletePending,
        })
        .from(beatmaps)
        .innerJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
        .where(inArray(beatmaps.id, ids));

      const byId = new Map(rows.map((row) => [row.id, row]));
      const sources: MarathonSource[] = [];

      for (const id of ids) {
        const row = byId.get(id);
        if (!row || row.hidden || row.setDeletePending) {
          continue;
        }

        const osuText = readOsuText(row.hash);
        if ((row.rulesetShortName ?? "").toLowerCase() !== "mania") {
          continue;
        }
        if (!row.audioFileHash || !lazerFileExists(row.audioFileHash)) {
          continue;
        }
        if (!osuText) {
          continue;
        }
        const chart = parseOsuChart(osuText);
        if (chart.status === "NotMania" || chart.gameMode !== "3") {
          continue;
        }
        if (chart.status === "Fail" || chart.columnCount <= 0) {
          continue;
        }

        sources.push({
          id: row.id,
          title: row.title,
          artist: row.artist,
          difficultyName: row.difficultyName,
          mapperUsername: row.mapperUsername,
          starRating: row.starRating,
          keyCount: chart.columnCount,
          onlineId: row.onlineId,
          setOnlineId: row.setOnlineId,
          audioFileHash: row.audioFileHash,
          backgroundFileHash: row.backgroundFileHash,
          osuText,
          error: null,
        });
      }

      const usable = sources.filter((s) => !s.error && s.osuText);
      const keys = new Set(usable.map((s) => s.keyCount).filter((k) => k != null));
      return {
        keyCount: keys.size === 1 ? (usable[0]?.keyCount ?? null) : null,
        sources,
      };
    },
    {
      body: t.Object({
        ids: t.Array(t.String(), {
          minItems: 1,
          maxItems: MARATHON_MAX_MAPS,
        }),
      }),
    },
  )
  .post("/open-in-osu", async ({ request, set }) => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      set.status = 400;
      return { error: "Expected multipart form data" };
    }

    const uploaded = form.get("file");
    if (!(uploaded instanceof Blob) || uploaded.size === 0) {
      set.status = 400;
      return { error: "Missing .osz file" };
    }
    if (uploaded.size > OPEN_OSZ_MAX_BYTES) {
      set.status = 400;
      return { error: "Archive is too large" };
    }

    const nameField = form.get("filename");
    const rawName =
      (typeof nameField === "string" && nameField.trim()) ||
      (uploaded instanceof File && uploaded.name) ||
      "marathon.osz";
    const filename = sanitizeDownloadFilename(rawName, ".osz");
    const dir = ensureBeatmapsDownloadDir();
    const dest = path.join(dir, filename);
    const bytes = new Uint8Array(await uploaded.arrayBuffer());
    writeFileSync(dest, bytes);
    writeOsuImportScripts(dir, [dest]);
    await openOszWithOsu(dest);
    return { opened: 1, filename, path: dest };
  });
