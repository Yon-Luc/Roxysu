import type { Db } from "@roxysu/db/client.bun";
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

let dbRef: Db | null = null;
let settings: TosuSettings | null = null;
let wsClient: TosuWsClient | null = null;
let status: TosuConnectionStatus = "disabled";
let warnings: string[] = [];
let beatmap: TosuLiveBeatmap | null = null;
let play: TosuLivePlay | null = null;
let matchedBeatmapId: string | null = null;
let analyzing = false;
let sunny: TosuLiveSnapshot["analysis"]["sunny"] = null;
let pattern: TosuLiveSnapshot["analysis"]["pattern"] = null;
let lastChecksum: string | null = null;
let analysisToken = 0;
let lastPlayPublishAt = 0;
let lastSpawnAttemptAt = 0;
let probeTimer: ReturnType<typeof setInterval> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function uniqueWarnings(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}

function emit(force = false): void {
  const now = Date.now();
  if (!force && play?.active) {
    if (now - lastPlayPublishAt < PLAY_PUBLISH_MS) return;
  }
  lastPlayPublishAt = now;
  publish({ type: "tosu.updated" });
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
    updatedAt: nowIso(),
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

async function runAnalysisForBeatmap(next: TosuLiveBeatmap): Promise<void> {
  if (!dbRef || !settings) return;
  const token = ++analysisToken;
  analyzing = true;
  emit(true);

  try {
    const result = await analyzeLiveMap(dbRef, settings.host, next);
    if (token !== analysisToken) return;
    matchedBeatmapId = result.matchedBeatmapId;
    sunny = result.analysis.sunny;
    pattern = result.analysis.pattern;
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
    pattern = null;
    matchedBeatmapId = null;
  } finally {
    if (token === analysisToken) {
      analyzing = false;
      emit(true);
    }
  }
}

function onFrame(frame: {
  beatmap: TosuLiveBeatmap;
  play: TosuLivePlay;
}): void {
  const checksumChanged = frame.beatmap.checksum !== lastChecksum;
  beatmap = frame.beatmap;
  play = frame.play;

  if (checksumChanged) {
    lastChecksum = frame.beatmap.checksum;
    sunny = null;
    pattern = null;
    matchedBeatmapId = null;
    if (frame.beatmap.checksum || frame.beatmap.title) {
      void runAnalysisForBeatmap(frame.beatmap);
    }
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

export async function startTosuAdapter(db: Db): Promise<void> {
  dbRef = db;
  settings = await readTosuSettings(db);

  stopWs();
  stopProbeLoop();

  if (!settings.enabled) {
    status = "disabled";
    warnings = [];
    beatmap = null;
    play = null;
    matchedBeatmapId = null;
    sunny = null;
    pattern = null;
    analyzing = false;
    lastChecksum = null;
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
