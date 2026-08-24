
import type { Db } from "@roxysu/db/types";
import type { ManiaPatternDetail } from "../map-analysis";
import { publish } from "../shared/events";
import { analyzeLiveMap } from "./analyze";
import { connectTosuWs, type TosuWsClient } from "./client";
import { readTosuSettings, type TosuSettings } from "./settings";
import { spawnTosu } from "./spawn";
import { probeTosuHttp } from "./status";
import type {
  TosuConnectionStatus,
  TosuLiveBeatmap,
  TosuLivePlay,
  TosuLiveSnapshot,
} from "./types";

const PLAY_PUBLISH_MS = 500;
const SPAWN_COOLDOWN_MS = 60_000;
const RATE_ANALYSIS_DEBOUNCE_MS = 150;

let dbRef: Db | null = null;
let settings: TosuSettings | null = null;
let wsClient: TosuWsClient | null = null;
let status: TosuConnectionStatus = "disabled";
let warnings: string[] = [];
let beatmap: TosuLiveBeatmap | null = null;
let play: TosuLivePlay | null = null;
let matchedBeatmapId: string | null = null;
let backgroundFileHash: string | null = null;
let analyzing = false;
let sunny: TosuLiveSnapshot["analysis"]["sunny"] = null;
let pattern: TosuLiveSnapshot["analysis"]["pattern"] = null;
/** Full mania pattern detail for the current checksum (not on the lean snapshot). */
let patternDetail: ManiaPatternDetail | null = null;
let patternDetailChecksum: string | null = null;
let lastChecksum: string | null = null;
/** Rate we last finished analyzing at. */
let lastAnalyzedRate: number | null = null;
/** Rate we already scheduled a recompute for (avoids debounce reset spam). */
let pendingRate: number | null = null;
let osuTextCache: string | null = null;
let osuTextChecksum: string | null = null;
let analysisToken = 0;
let lastPlayPublishAt = 0;
let lastSpawnAttemptAt = 0;
let probeTimer: ReturnType<typeof setInterval> | null = null;
let rateDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueWarnings(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

function roundRate(rate: number): number {
  return Math.round(rate * 1000) / 1000;
}

function emit(force = false): void {
  const now = Date.now();
  if (!force) {
    if (now - lastPlayPublishAt < PLAY_PUBLISH_MS) return;
    lastPlayPublishAt = now;
    publish({
      type: "tosu.updated",
      reason: "play",
      play,
      beatmapState: beatmap?.state ?? null,
      beatmapTimeMs: beatmap?.timeLiveMs ?? null,
    });
    return;
  }
  lastPlayPublishAt = now;
  publish({ type: "tosu.updated", reason: "full" });
}

export function getTosuLiveSnapshot(): TosuLiveSnapshot {
  const host = settings?.host ?? "127.0.0.1:24050";
  const enabled = settings?.enabled ?? false;
  return {
    connected: status === "connected",
    status: enabled ? status : "disabled",
    host,
    enabled,
    warnings: uniqueWarnings(warnings),
    beatmap,
    play,
    analysis: {
      sunny,
      pattern,
      analyzing,
    },
    matchedBeatmapId,
    backgroundFileHash,
    updatedAt: nowIso(),
  };
}

export type TosuLiveAnalysisPayload = {
  checksum: string | null;
  matchedBeatmapId: string | null;
  detail: ManiaPatternDetail | null;
};

export function getTosuLiveAnalysis(): TosuLiveAnalysisPayload {
  return {
    checksum: patternDetailChecksum,
    matchedBeatmapId,
    detail: patternDetail,
  };
}

async function refreshProbeAndMaybeSpawn(opts: {
  allowSpawn: boolean;
}): Promise<void> {
  if (!settings?.enabled || !dbRef) return;

  const probe = await probeTosuHttp(settings.host);
  const nextWarnings = [...probe.warnings];

  if (!probe.httpUp && opts.allowSpawn) {
    const now = Date.now();
    if (now - lastSpawnAttemptAt >= SPAWN_COOLDOWN_MS) {
      lastSpawnAttemptAt = now;
      if (!settings.executablePath) {
        nextWarnings.push(
          "Tosu executable path is not configured. Set it in Settings to auto-start tosu.",
        );
      } else {
        const result = spawnTosu(settings.executablePath);
        if (result.ok) {
          nextWarnings.push("Tosu was down — attempted to start it.");
        } else {
          nextWarnings.push(result.warning);
        }
      }
    }
  }

  warnings = uniqueWarnings(nextWarnings);
}

async function runAnalysisForBeatmap(
  next: TosuLiveBeatmap,
  opts: { sunnyOnly: boolean },
): Promise<void> {
  if (!dbRef || !settings) return;
  const token = ++analysisToken;
  analyzing = true;
  emit(true);

  try {
    const cache =
      osuTextChecksum === next.checksum ? osuTextCache : null;
    const result = await analyzeLiveMap(dbRef, settings.host, next, {
      osuTextCache: cache,
      sunnyOnly: opts.sunnyOnly,
      previousPattern: opts.sunnyOnly ? pattern : null,
      previousPatternDetail: opts.sunnyOnly ? patternDetail : null,
    });
    if (token !== analysisToken) return;
    matchedBeatmapId = result.matchedBeatmapId;
    backgroundFileHash = result.backgroundFileHash;
    sunny = result.analysis.sunny;
    pattern = result.analysis.pattern;
    if (!opts.sunnyOnly) {
      patternDetail = result.patternDetail;
      patternDetailChecksum = next.checksum;
    }
    if (result.osuText && next.checksum) {
      osuTextCache = result.osuText;
      osuTextChecksum = next.checksum;
    }
    lastAnalyzedRate = roundRate(next.rate);
    pendingRate = null;
  } catch (err) {
    if (token !== analysisToken) return;
    sunny = {
      sunnyStar: null,
      estDiff: null,
      lnRatio: null,
      columnCount: null,
      error: err instanceof Error ? err.message : String(err),
      source: "osu-text",
    };
    if (!opts.sunnyOnly) {
      pattern = null;
      patternDetail = null;
      patternDetailChecksum = next.checksum;
      matchedBeatmapId = null;
      backgroundFileHash = null;
    }
    pendingRate = null;
  } finally {
    if (token === analysisToken) {
      analyzing = false;
      emit(true);
    }
  }
}

/**
 * Recompute Sunny when rate changes. Only (re)arms the debounce when the
 * target rate differs from what we already scheduled — continuous tosu WS
 * frames were previously resetting the timer forever so analysis never ran.
 */
function scheduleRateAnalysis(next: TosuLiveBeatmap): void {
  const target = roundRate(next.rate);
  if (lastAnalyzedRate != null && target === lastAnalyzedRate) return;
  if (pendingRate != null && target === pendingRate) return;

  pendingRate = target;
  if (rateDebounceTimer) clearTimeout(rateDebounceTimer);
  rateDebounceTimer = setTimeout(() => {
    rateDebounceTimer = null;
    const current = beatmap;
    if (!current) {
      pendingRate = null;
      return;
    }
    const rate = roundRate(current.rate);
    if (lastAnalyzedRate != null && rate === lastAnalyzedRate) {
      pendingRate = null;
      return;
    }
    void runAnalysisForBeatmap(current, { sunnyOnly: true });
  }, RATE_ANALYSIS_DEBOUNCE_MS);
}

function onFrame(frame: {
  beatmap: TosuLiveBeatmap;
  play: TosuLivePlay;
}): void {
  const checksumChanged = frame.beatmap.checksum !== lastChecksum;
  const nextRate = roundRate(frame.beatmap.rate);
  const rateChanged =
    lastAnalyzedRate != null && nextRate !== lastAnalyzedRate;

  beatmap = frame.beatmap;
  play = frame.play;

  if (checksumChanged) {
    if (rateDebounceTimer) {
      clearTimeout(rateDebounceTimer);
      rateDebounceTimer = null;
    }
    lastChecksum = frame.beatmap.checksum;
    lastAnalyzedRate = null;
    pendingRate = null;
    osuTextCache = null;
    osuTextChecksum = null;
    sunny = null;
    pattern = null;
    patternDetail = null;
    patternDetailChecksum = null;
    matchedBeatmapId = null;
    backgroundFileHash = null;
    if (frame.beatmap.checksum || frame.beatmap.title) {
      void runAnalysisForBeatmap(frame.beatmap, { sunnyOnly: false });
    }
    emit(true);
    return;
  }

  if (rateChanged && (frame.beatmap.checksum || frame.beatmap.title)) {
    scheduleRateAnalysis(frame.beatmap);
    emit(true);
    return;
  }

  emit(false);
}

function stopWs(): void {
  wsClient?.stop();
  wsClient = null;
}

function startWs(): void {
  if (!settings?.enabled) return;
  stopWs();
  status = "connecting";
  emit(true);

  wsClient = connectTosuWs(settings.host, {
    onOpen: () => {
      status = "connected";
      void refreshProbeAndMaybeSpawn({ allowSpawn: false }).then(() =>
        emit(true),
      );
    },
    onClose: () => {
      if (!settings?.enabled) return;
      status = "disconnected";
      void refreshProbeAndMaybeSpawn({ allowSpawn: true }).then(() =>
        emit(true),
      );
    },
    onError: () => {
      if (status === "connected") return;
      status = "disconnected";
    },
    onMessage: onFrame,
  });
}

function stopProbeLoop(): void {
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

function startProbeLoop(): void {
  stopProbeLoop();
  probeTimer = setInterval(() => {
    if (!settings?.enabled) return;
    if (status === "connected") {
      void refreshProbeAndMaybeSpawn({ allowSpawn: false }).then(() =>
        emit(true),
      );
      return;
    }
    void refreshProbeAndMaybeSpawn({ allowSpawn: true }).then(() => emit(true));
  }, 15_000);
}

/**
 * Run `startTosuAdapter` once per process. Entry points kick this off at boot
 * (without awaiting) and the `/tosu/live` route awaits it, so the snapshot can
 * never be served before settings are loaded — an uninitialized adapter reads
 * as `enabled: false`, which clients cache as "tosu live adapter is off".
 */
let bootstrapPromise: Promise<void> | null = null;

export function ensureTosuStarted(db: Db): Promise<void> {
  if (!bootstrapPromise) bootstrapPromise = startTosuAdapter(db);
  return bootstrapPromise;
}

export async function startTosuAdapter(db: Db): Promise<void> {
  dbRef = db;
  settings = await readTosuSettings(db);

  stopWs();
  stopProbeLoop();
  if (rateDebounceTimer) {
    clearTimeout(rateDebounceTimer);
    rateDebounceTimer = null;
  }

  if (!settings.enabled) {
    status = "disabled";
    warnings = [];
    beatmap = null;
    play = null;
    matchedBeatmapId = null;
    backgroundFileHash = null;
    sunny = null;
    pattern = null;
    patternDetail = null;
    patternDetailChecksum = null;
    analyzing = false;
    lastChecksum = null;
    lastAnalyzedRate = null;
    pendingRate = null;
    osuTextCache = null;
    osuTextChecksum = null;
    emit(true);
    return;
  }

  status = "connecting";
  await refreshProbeAndMaybeSpawn({ allowSpawn: true });
  startWs();
  startProbeLoop();
  emit(true);
}

export async function restartTosuAdapter(db: Db): Promise<void> {
  await startTosuAdapter(db);
}

export function stopTosuAdapter(): void {
  stopWs();
  stopProbeLoop();
  if (rateDebounceTimer) {
    clearTimeout(rateDebounceTimer);
    rateDebounceTimer = null;
  }
  status = "disabled";
  analysisToken += 1;
  analyzing = false;
}

export async function requestTosuStart(db: Db): Promise<TosuLiveSnapshot> {
  dbRef = db;
  settings = await readTosuSettings(db);
  lastSpawnAttemptAt = 0;
  await refreshProbeAndMaybeSpawn({ allowSpawn: true });

  if (settings.enabled && status !== "connected") {
    startWs();
  }

  emit(true);
  return getTosuLiveSnapshot();
}
