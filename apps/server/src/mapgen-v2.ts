import { readFileSync } from "node:fs";
import {
  and,
  beatmapDanRatings,
  beatmaps,
  eq,
  isNotNull,
  type Db,
} from "@roxysu/db/client.bun";
import { parse7kChart } from "@roxysu/osu-chart";
import { analyzeAudioFile } from "@roxysu/audio-analysis";
import { generateMapFromAudio } from "@roxysu/mapgen-core";
import {
  buildMarkovTransitionTable,
  buildReferenceStats,
  pickRegressionCandidates,
  scoreMapgenChart,
  type CorpusChartRow,
  type ReferenceStats,
  type RegressionCandidate,
} from "../../../packages/mapgen-eval/src/index";
import { getOsuDataPath, lazerFileExists, resolveLazerFilePath } from "./shared/lazer-files";
import { resolveFfmpegPath } from "./shared/ffmpeg-path";

const DEFAULT_LIBRARY_LIMIT = 320;

export type MapgenV2Assets = {
  builtAt: string;
  sampleCount: number;
  referenceStats: ReferenceStats;
  markovModel: ReturnType<typeof buildMarkovTransitionTable>;
  regressionSet: RegressionCandidate[];
};

export type RegressionBaselineRow = {
  beatmapId: string;
  title: string | null;
  version: 1 | 2;
  noteCount: number;
  notesPerSecondVerdict: string;
  entropyVerdict: string;
  rcIssues: number;
};

let assetsPromise: Promise<MapgenV2Assets | null> | null = null;

async function loadLibraryCharts(db: Db, limit = DEFAULT_LIBRARY_LIMIT): Promise<CorpusChartRow[]> {
  const rows = await db
    .select({
      beatmapId: beatmaps.id,
      bpm: beatmaps.bpm,
      starRating: beatmapDanRatings.sunnyStar,
      fallbackStar: beatmaps.starRating,
      hash: beatmaps.hash,
    })
    .from(beatmaps)
    .leftJoin(
      beatmapDanRatings,
      and(
        eq(beatmapDanRatings.beatmapId, beatmaps.id),
        eq(beatmapDanRatings.algorithm, "sunny"),
      ),
    )
    .where(
      and(
        eq(beatmaps.rulesetShortName, "mania"),
        eq(beatmaps.circleSize, 7),
        isNotNull(beatmaps.hash),
      ),
    )
    .limit(limit);

  const charts: CorpusChartRow[] = [];
  for (const row of rows) {
    if (!row.hash || !lazerFileExists(row.hash, getOsuDataPath())) continue;
    const filePath = resolveLazerFilePath(row.hash, getOsuDataPath());
    if (!filePath) continue;
    try {
      const chart = parse7kChart(readFileSync(filePath, "utf8"));
      charts.push({
        beatmapId: row.beatmapId,
        bpm: row.bpm,
        starRating: row.starRating ?? row.fallbackStar ?? 0,
        chart,
      });
    } catch {
      // Skip malformed / non-7k charts.
    }
  }
  return charts;
}

async function loadRegressionRows(db: Db, limit = DEFAULT_LIBRARY_LIMIT): Promise<RegressionCandidate[]> {
  const rows = await db
    .select({
      beatmapId: beatmaps.id,
      title: beatmaps.title,
      artist: beatmaps.artist,
      difficultyName: beatmaps.difficultyName,
      bpm: beatmaps.bpm,
      starRating: beatmaps.starRating,
      mapperUsername: beatmaps.mapperUsername,
      audioFileHash: beatmaps.audioFileHash,
    })
    .from(beatmaps)
    .where(
      and(
        eq(beatmaps.rulesetShortName, "mania"),
        eq(beatmaps.circleSize, 7),
        isNotNull(beatmaps.audioFileHash),
      ),
    )
    .limit(limit);

  return pickRegressionCandidates(
    rows
      .filter((row) => row.audioFileHash && lazerFileExists(row.audioFileHash, getOsuDataPath()))
      .map((row) => ({
        ...row,
        audioFileHash: row.audioFileHash!,
      })),
    32,
  );
}

async function buildAssets(db: Db): Promise<MapgenV2Assets | null> {
  const charts = await loadLibraryCharts(db);
  if (charts.length === 0) return null;

  const referenceStats = buildReferenceStats(
    charts.map((row) => ({
      chart: row.chart,
      sunnyStar: row.starRating,
      explicitBpm: row.bpm,
    })),
  );
  const markovModel = buildMarkovTransitionTable(charts, 3);
  const regressionSet = await loadRegressionRows(db);

  return {
    builtAt: new Date().toISOString(),
    sampleCount: charts.length,
    referenceStats,
    markovModel,
    regressionSet,
  };
}

export function getMapgenV2Assets(db: Db): Promise<MapgenV2Assets | null> {
  assetsPromise ??= buildAssets(db);
  return assetsPromise;
}

export function invalidateMapgenV2Assets(): void {
  assetsPromise = null;
}

export async function runRegressionBaseline(
  db: Db,
  options: { limit?: number } = {},
): Promise<RegressionBaselineRow[]> {
  const assets = await getMapgenV2Assets(db);
  if (!assets) return [];
  const ffmpegPath = await resolveFfmpegPath();
  const limit = Math.max(1, Math.min(options.limit ?? 8, assets.regressionSet.length));
  const rows: RegressionBaselineRow[] = [];
  for (const candidate of assets.regressionSet.slice(0, limit)) {
    const audioPath = resolveLazerFilePath(candidate.audioFileHash, getOsuDataPath());
    if (!audioPath) continue;
    try {
      const audio = await analyzeAudioFile(audioPath, {
        algorithm: "audio-v2",
        ffmpegPath,
      });
      const result = generateMapFromAudio(
        audio,
        {},
        {
          endMs: Math.min(audio.durationMs, 90_000),
          bpm: candidate.bpm,
          metadata: {
            title: candidate.title ?? "Regression",
            artist: candidate.artist ?? "Unknown",
            version: "Regression Baseline",
          },
          version: 1,
        },
      );
      const score = scoreMapgenChart(
        {
          chart: result.chart,
          sunnyStar: candidate.starRating,
          explicitBpm: candidate.bpm,
        },
        assets.referenceStats,
      );
      rows.push({
        beatmapId: candidate.beatmapId,
        title: candidate.title,
        version: 1,
        noteCount: result.notes.length,
        notesPerSecondVerdict: score.metrics.notesPerSecond.verdict,
        entropyVerdict: score.metrics.transitionEntropy.verdict,
        rcIssues: score.rc.illegalOverlaps + score.rc.emptyColumns,
      });
    } catch {
      // ignore missing/undecodable audio
    }
  }
  return rows;
}
