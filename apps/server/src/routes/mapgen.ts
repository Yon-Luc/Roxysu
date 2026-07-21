import { Elysia, t } from "elysia";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { tmpdir } from "node:os";
import { analyzeAudioFile } from "@roxysu/audio-analysis";
import {
  analyzeGeneratedPatterns,
  buildManiaOsuText,
  generateMapFromAudio,
  resolveDanPreset,
  type MapgenResult,
} from "@roxysu/mapgen-core";
import { scoreMapgenChart } from "../../../../packages/mapgen-eval/src/index";
import {
  ffmpegUnavailableMessage,
  isFfmpegAvailableAt,
  resolveFfmpegPath,
} from "../shared/ffmpeg-path";
import { buildZip } from "../map-analysis/zipStore";
import { runSunnyEstimatorFromText } from "../map-analysis/sunnyEstimator";
import { db } from "../db";
import { getMapgenV2Assets, runRegressionBaseline } from "../mapgen-v2";

const AUDIO_EXTS = new Set([
  ".mp3",
  ".ogg",
  ".wav",
  ".flac",
  ".m4a",
  ".aac",
  ".opus",
]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function sanitizeFilename(name: string): string {
  return basename(name).replace(/[^\w.\- ()[\]]+/g, "_");
}

function parseNum(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseStr(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function setMapgenHeaders(
  set: { headers: Record<string, string | number> },
  result: MapgenResult,
  analysis: ReturnType<typeof analyzeGeneratedPatterns>,
  osuText: string,
  evalScore?: ReturnType<typeof scoreMapgenChart> | null,
): void {
  set.headers["X-Mapgen-Bpm"] = String(result.bpm);
  set.headers["X-Mapgen-Notes"] = String(result.notes.length);
  set.headers["X-Mapgen-Dominant"] = analysis.dominantPattern;
  set.headers["X-Mapgen-Segments"] = String(result.segments.length);
  set.headers["X-Mapgen-Offset-Ms"] = String(result.timingOffsetMs);
  set.headers["X-Mapgen-Bpm-Confidence"] = String(
    Math.round(result.bpmConfidence * 100),
  );
  if (result.bpmAlternates.length > 0) {
    set.headers["X-Mapgen-Bpm-Alts"] = result.bpmAlternates.join(",");
  }
  if (result.dan) {
    set.headers["X-Mapgen-Dan-Target"] = result.dan.label;
  }
  set.headers["X-Mapgen-Ln"] = String(
    Math.round((result.targets.ln ?? 0) * 100),
  );
  set.headers["X-Mapgen-Timing-Points"] = String(result.timingPoints.length);
  set.headers["X-Mapgen-Version"] = String(result.version);
  set.headers["X-Mapgen-Stage2"] = result.stage2Backend;
  if (result.timingPoints.length > 1) {
    const bpmChanges = result.timingPoints
      .map(([t, beatLen]) => `${Math.round(t)}:${(60_000 / beatLen).toFixed(1)}`)
      .join(",");
    set.headers["X-Mapgen-Bpm-Map"] = bpmChanges;
  }

  try {
    const sunny = runSunnyEstimatorFromText(osuText);
    set.headers["X-Mapgen-Est-Diff"] = sunny.estDiff;
    set.headers["X-Mapgen-Sunny-Star"] = sunny.star.toFixed(2);
    set.headers["X-Mapgen-Sunny-Ln"] = String(
      Math.round(sunny.lnRatio * 100),
    );
  } catch {
    // Sunny can fail on very short charts; pack is still valid.
  }
  if (evalScore) {
    set.headers["X-Mapgen-Eval-Bucket"] =
      evalScore.bucket != null
        ? `${evalScore.bucket.starBand}@${evalScore.bucket.bpmBand}`
        : "n/a";
    set.headers["X-Mapgen-Eval-Nps"] = evalScore.metrics.notesPerSecond.verdict;
    set.headers["X-Mapgen-Eval-Entropy"] =
      evalScore.metrics.transitionEntropy.verdict;
    set.headers["X-Mapgen-Eval-Rc"] = String(
      evalScore.rc.illegalOverlaps + evalScore.rc.emptyColumns,
    );
  }
}

/** Try a few density knobs and keep the chart closest to the dan's target★. */
function generateForDanTarget(
  audioAnalysis: Parameters<typeof generateMapFromAudio>[0],
  targets: Parameters<typeof generateMapFromAudio>[1],
  baseOptions: Parameters<typeof generateMapFromAudio>[2],
): MapgenResult {
  const dan = resolveDanPreset(baseOptions?.dan);
  const base = generateMapFromAudio(audioAnalysis, targets, baseOptions);
  if (!dan) return base;

  const candidates: Array<{ snapDivisor: number; noteStride: number }> = [
    { snapDivisor: dan.snapDivisor, noteStride: dan.noteStride },
    { snapDivisor: 4, noteStride: Math.max(1, dan.noteStride) },
    { snapDivisor: 4, noteStride: 1 },
    { snapDivisor: 8, noteStride: 2 },
    { snapDivisor: 8, noteStride: 1 },
  ];

  // Deduplicate
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = `${c.snapDivisor}:${c.noteStride}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let best = base;
  let bestDist = Infinity;

  for (const cand of unique) {
    const result = generateMapFromAudio(audioAnalysis, targets, {
      ...baseOptions,
      snapDivisor: cand.snapDivisor,
      noteStride: cand.noteStride,
    });
    try {
      const sunny = runSunnyEstimatorFromText(buildManiaOsuText(result.chart));
      // Prefer correct RC/LN axis, then closest star.
      const axisPenalty =
        dan.axis === "ln" && sunny.lnRatio < 0.2
          ? 5
          : dan.axis === "rc" && sunny.lnRatio >= 0.2
            ? 5
            : 0;
      const dist = Math.abs(sunny.star - dan.targetStar) + axisPenalty;
      if (dist < bestDist) {
        bestDist = dist;
        best = result;
      }
    } catch {
      // ignore unscorable candidates
    }
  }

  return best;
}

export const mapgenRoutes = new Elysia({ prefix: "/mapgen" })
  .get("/status", async () => {
    const ffmpegPath = await resolveFfmpegPath();
    const available = await isFfmpegAvailableAt(ffmpegPath);
    return {
      ffmpegAvailable: available,
      ffmpegPath,
      message: available ? null : ffmpegUnavailableMessage(ffmpegPath),
    };
  })
  .get("/v2/status", async () => {
    const assets = await getMapgenV2Assets(db);
    return {
      ready: assets != null,
      builtAt: assets?.builtAt ?? null,
      sampleCount: assets?.sampleCount ?? 0,
      regressionCount: assets?.regressionSet.length ?? 0,
      bucketCount: assets?.referenceStats.buckets.length ?? 0,
    };
  })
  .get("/v2/regression", async () => {
    const assets = await getMapgenV2Assets(db);
    return {
      builtAt: assets?.builtAt ?? null,
      items: assets?.regressionSet ?? [],
    };
  })
  .get("/v2/regression/baseline", async () => {
    return {
      items: await runRegressionBaseline(db),
    };
  })
  .post(
    "/",
    async ({ body, set }) => {
      const ffmpegPath = await resolveFfmpegPath();
      if (!(await isFfmpegAvailableAt(ffmpegPath))) {
        set.status = 503;
        return {
          error: ffmpegUnavailableMessage(ffmpegPath),
        };
      }

      const audio = body.audio;
      if (!audio || !(audio instanceof File)) {
        set.status = 400;
        return { error: "Audio file is required (field: audio)" };
      }

      const audioName = sanitizeFilename(audio.name || "audio.mp3");
      const audioExt = extname(audioName).toLowerCase();
      if (audioExt && !AUDIO_EXTS.has(audioExt)) {
        set.status = 400;
        return {
          error: `Unsupported audio type ${audioExt} (use mp3/ogg/wav/flac)`,
        };
      }

      const workDir = join(
        tmpdir(),
        `roxysu-mapgen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(workDir, { recursive: true });

      try {
        const audioPath = join(workDir, audioName);
        writeFileSync(audioPath, Buffer.from(await audio.arrayBuffer()));

        let backgroundFilename: string | undefined;
        let backgroundBytes: Uint8Array | undefined;
        const bg = body.background;
        if (bg && bg instanceof File && bg.size > 0) {
          const bgName = sanitizeFilename(bg.name || "bg.jpg");
          const bgExt = extname(bgName).toLowerCase();
          if (bgExt && !IMAGE_EXTS.has(bgExt)) {
            set.status = 400;
            return {
              error: `Unsupported image type ${bgExt} (use jpg/png/webp)`,
            };
          }
          backgroundFilename = bgName;
          backgroundBytes = new Uint8Array(await bg.arrayBuffer());
          writeFileSync(join(workDir, bgName), backgroundBytes);
        }

        const audioAnalysis = await analyzeAudioFile(audioPath, { ffmpegPath });

        const title =
          parseStr(body.title) ??
          audioName.replace(/\.[^.]+$/, "") ??
          "Generated Chart";
        const artist = parseStr(body.artist) ?? "Unknown";
        const creator = parseStr(body.creator) ?? "Roxysu Mapgen";
        const dan = parseStr(body.dan);
        const difficultyVersion =
          parseStr(body.version) ??
          (dan ? undefined : "Generated");

        const mapgenVersion = parseNum(body.versionCode) === 2 ? 2 : 1;
        const assets = mapgenVersion === 2 ? await getMapgenV2Assets(db) : null;
        const result = generateForDanTarget(
          audioAnalysis,
          {
            delay: parseNum(body.delay),
            jack: parseNum(body.jack),
            chordjack: parseNum(body.chordjack),
            chordstream: parseNum(body.chordstream),
            bracket: parseNum(body.bracket),
            ln: parseNum(body.ln),
          },
          {
            bpm: parseNum(body.bpm),
            seed: parseNum(body.seed),
            dan,
            endMs:
              parseNum(body.endSec) != null
                ? parseNum(body.endSec)! * 1000
                : undefined,
            snapDivisor: parseNum(body.snapDivisor),
            segmentBeats: parseNum(body.segmentBeats),
            noteStride: parseNum(body.noteStride),
            timingOffsetMs: parseNum(body.timingOffsetMs),
            version: mapgenVersion,
            stage2Backend: mapgenVersion === 2 ? "markov" : "template",
            markovModel: assets?.markovModel,
            audioFilename: audioName,
            metadata: {
              title,
              artist,
              creator,
              version: difficultyVersion,
              backgroundFilename,
            },
          },
        );

        const osuText = buildManiaOsuText(result.chart);
        const osuName = `${title.replace(/[^\w.\- ]+/g, "_")} [${result.chart.metadata.version}].osu`;
        const analysis = analyzeGeneratedPatterns(result.notes);

        const format = parseStr(body.format) ?? "zip";
        const sunny = (() => {
          try {
            return runSunnyEstimatorFromText(osuText);
          } catch {
            return null;
          }
        })();
        const evalScore =
          assets?.referenceStats != null
            ? scoreMapgenChart(
                {
                  chart: result.chart,
                  sunnyStar: sunny?.star ?? null,
                  explicitBpm: result.bpm,
                },
                assets.referenceStats,
              )
            : null;
        setMapgenHeaders(set, result, analysis, osuText, evalScore);

        if (format === "osu") {
          set.headers["Content-Type"] = "application/octet-stream";
          set.headers["Content-Disposition"] =
            `attachment; filename="${osuName.replace(/"/g, "")}"`;
          return new Response(osuText);
        }

        const entries = [
          {
            name: osuName,
            data: new TextEncoder().encode(osuText),
          },
          {
            name: audioName,
            data: new Uint8Array(readFileSync(audioPath)),
          },
        ];
        if (backgroundFilename && backgroundBytes) {
          entries.push({ name: backgroundFilename, data: backgroundBytes });
        }

        const zip = buildZip(entries);
        const zipName = `${title.replace(/[^\w.\- ]+/g, "_")}.osz`;
        set.headers["Content-Type"] = "application/zip";
        set.headers["Content-Disposition"] =
          `attachment; filename="${zipName.replace(/"/g, "")}"`;
        return new Response(zip);
      } catch (err) {
        set.status = 500;
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        try {
          rmSync(workDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      }
    },
    {
      body: t.Object({
        audio: t.File(),
        background: t.Optional(t.File()),
        title: t.Optional(t.String()),
        artist: t.Optional(t.String()),
        creator: t.Optional(t.String()),
        version: t.Optional(t.String()),
        delay: t.Optional(t.String()),
        jack: t.Optional(t.String()),
        chordjack: t.Optional(t.String()),
        chordstream: t.Optional(t.String()),
        bracket: t.Optional(t.String()),
        ln: t.Optional(t.String()),
        bpm: t.Optional(t.String()),
        seed: t.Optional(t.String()),
        endSec: t.Optional(t.String()),
        snapDivisor: t.Optional(t.String()),
        segmentBeats: t.Optional(t.String()),
        noteStride: t.Optional(t.String()),
        timingOffsetMs: t.Optional(t.String()),
        dan: t.Optional(t.String()),
        versionCode: t.Optional(t.String()),
        format: t.Optional(t.String()),
      }),
    },
  );
