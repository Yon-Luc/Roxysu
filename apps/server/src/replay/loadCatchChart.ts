import { beatmapSets, beatmaps } from "@roxysu/db/schema";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

import { parseCatchChart, type CatchHitObject } from "@roxysu/osu-chart";
import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import type { Db } from "../db-runtime";

export type LoadedCatchChart = {
  beatmapId: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  setOnlineId: number | null;
  rulesetShortName: string | null;
  overallDifficulty: number;
  circleSize: number;
  approachRate: number;
  previewTime: number | null;
  audioFileHash: string | null;
  backgroundFileHash: string | null;
  lengthMs: number;
  hitObjects: CatchHitObject[];
  usedBeatmapHash: string;
};

export async function loadCatchChartForScore(
  db: Db,
  score: {
    beatmapId: string | null;
    beatmapHash: string | null;
  },
): Promise<
  | { ok: true; chart: LoadedCatchChart }
  | { ok: false; status: number; error: string }
> {
  if (!score.beatmapId) {
    return { ok: false, status: 422, error: "Score has no beatmap" };
  }

  const [row] = await db
    .select({
      id: beatmaps.id,
      hash: beatmaps.hash,
      rulesetShortName: beatmaps.rulesetShortName,
      previewTime: beatmaps.previewTime,
      audioFileHash: beatmaps.audioFileHash,
      backgroundFileHash: beatmaps.backgroundFileHash,
      title: beatmaps.title,
      artist: beatmaps.artist,
      difficultyName: beatmaps.difficultyName,
      overallDifficulty: beatmaps.overallDifficulty,
      circleSize: beatmaps.circleSize,
      approachRate: beatmaps.approachRate,
      length: beatmaps.length,
      setOnlineId: beatmapSets.onlineId,
    })
    .from(beatmaps)
    .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
    .where(eq(beatmaps.id, score.beatmapId))
    .limit(1);

  if (!row) {
    return { ok: false, status: 404, error: "Beatmap not found" };
  }

  if (row.rulesetShortName !== "fruits") {
    return { ok: false, status: 422, error: "Beatmap is not catch" };
  }

  const candidates = [score.beatmapHash, row.hash].filter(
    (h): h is string => typeof h === "string" && /^[0-9a-f]{64}$/i.test(h),
  );

  let usedHash: string | null = null;
  let osuText: string | null = null;
  for (const hash of candidates) {
    const filePath = resolveLazerFilePath(hash, getOsuDataPath());
    if (!filePath) continue;
    try {
      osuText = readFileSync(filePath, "utf8");
      usedHash = hash.toLowerCase();
      break;
    } catch {
      // try next
    }
  }

  if (!osuText || !usedHash) {
    return {
      ok: false,
      status: 404,
      error: "Beatmap file not found in lazer files store",
    };
  }

  const chart = parseCatchChart(osuText);
  if (chart.status === "NotCatch") {
    return { ok: false, status: 422, error: "Beatmap is not catch" };
  }
  if (chart.status === "Fail" || chart.hitObjects.length === 0) {
    return { ok: false, status: 422, error: "Failed to parse beatmap" };
  }

  return {
    ok: true,
    chart: {
      beatmapId: row.id,
      title: row.title,
      artist: row.artist,
      difficultyName: row.difficultyName,
      setOnlineId: row.setOnlineId ?? null,
      rulesetShortName: row.rulesetShortName,
      overallDifficulty: chart.overallDifficulty,
      circleSize: chart.circleSize,
      approachRate: chart.approachRate,
      previewTime: row.previewTime,
      audioFileHash: row.audioFileHash,
      backgroundFileHash: row.backgroundFileHash,
      lengthMs: Math.round(row.length ?? 0),
      hitObjects: chart.hitObjects,
      usedBeatmapHash: usedHash,
    },
  };
}
