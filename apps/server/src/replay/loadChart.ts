import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { beatmaps, beatmapSets, scores } from "@roxysu/db/client.bun";
import { OsuFileParser, type ChartNote } from "@roxysu/osu-chart";
import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import type { Db } from "../db";

export type { ChartNote };

export type LoadedChart = {
  beatmapId: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  setOnlineId: number | null;
  rulesetShortName: string | null;
  overallDifficulty: number;
  previewTime: number | null;
  audioFileHash: string | null;
  backgroundFileHash: string | null;
  lengthMs: number;
  columnCount: number;
  notes: ChartNote[];
  /** Which beatmap content hash was used to load the .osu. */
  usedBeatmapHash: string;
};

/**
 * Load mania notes for a score, preferring the score's beatmapHash when it
 * still resolves in the local files store.
 */
export async function loadChartForScore(
  db: Db,
  score: {
    beatmapId: string | null;
    beatmapHash: string | null;
  },
): Promise<
  | { ok: true; chart: LoadedChart }
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

  if (row.rulesetShortName !== "mania") {
    return { ok: false, status: 422, error: "Replay rewatch is mania-only" };
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

  const parser = new OsuFileParser(osuText);
  parser.process();

  if (parser.status === "NotMania" || parser.gameMode !== "3") {
    return { ok: false, status: 422, error: "Beatmap is not mania" };
  }
  if (parser.status === "Fail" || parser.columnCount <= 0) {
    return { ok: false, status: 422, error: "Failed to parse beatmap" };
  }

  const notes: ChartNote[] = [];
  for (let i = 0; i < parser.noteStarts.length; i += 1) {
    notes.push({
      column: parser.columns[i]!,
      startMs: parser.noteStarts[i]!,
      endMs: parser.noteEnds[i]!,
    });
  }
  notes.sort((a, b) => a.startMs - b.startMs || a.column - b.column);

  const odFromMap =
    row.overallDifficulty != null && Number.isFinite(row.overallDifficulty)
      ? Number(row.overallDifficulty)
      : 5;

  return {
    ok: true,
    chart: {
      beatmapId: row.id,
      title: row.title,
      artist: row.artist,
      difficultyName: row.difficultyName,
      setOnlineId: row.setOnlineId ?? null,
      rulesetShortName: row.rulesetShortName,
      overallDifficulty: odFromMap,
      previewTime: row.previewTime,
      audioFileHash: row.audioFileHash,
      backgroundFileHash: row.backgroundFileHash,
      lengthMs: Math.round(row.length ?? 0),
      columnCount: parser.columnCount,
      notes,
      usedBeatmapHash: usedHash,
    },
  };
}

export async function getScoreRow(db: Db, scoreId: string) {
  const [row] = await db
    .select()
    .from(scores)
    .where(and(eq(scores.id, scoreId), eq(scores.deletePending, false)))
    .limit(1);
  return row ?? null;
}
