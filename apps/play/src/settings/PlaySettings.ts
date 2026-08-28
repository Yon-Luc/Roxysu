import { DEFAULT_7K_BINDINGS } from "../input/KeyBindings";

export type PlaySettings = {
  /** Playfield scroll speed in pixels per second. */
  scrollSpeed: number;
  /** Master output volume from 0 to 1. */
  masterVolume: number;
  /** Pre-play countdown duration in seconds. */
  countdownSeconds: number;
  /** User calibration offset added to chart time (milliseconds). */
  userOffsetMs: number;
  /** Key names per lane (7K), lowercase; use `space` for the space bar. */
  laneKeys: string[];
  /** Last beatmap selected in song select (restored on launch). */
  lastBeatmapId: string | null;
};

export const DEFAULT_LANE_KEYS = [...DEFAULT_7K_BINDINGS.laneKeys];

export const DEFAULT_PLAY_SETTINGS: PlaySettings = {
  scrollSpeed: 400,
  masterVolume: 0.85,
  countdownSeconds: 3,
  userOffsetMs: 0,
  laneKeys: DEFAULT_LANE_KEYS,
  lastBeatmapId: null,
};

export const DEFAULT_LANE_KEYS_JSON = JSON.stringify(DEFAULT_LANE_KEYS);

export function normalizeLaneKey(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "" || trimmed === "spacebar") return "space";
  return trimmed === " " ? "space" : trimmed;
}

export function parseLaneKeysJson(json: string | null | undefined): string[] {
  if (!json?.trim()) {
    return [...DEFAULT_LANE_KEYS];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 7) {
      return [...DEFAULT_LANE_KEYS];
    }
    const keys = parsed.map((value) =>
      typeof value === "string" ? normalizeLaneKey(value) : "",
    );
    if (keys.some((key) => key.length === 0)) {
      return [...DEFAULT_LANE_KEYS];
    }
    if (new Set(keys).size !== keys.length) {
      return [...DEFAULT_LANE_KEYS];
    }
    return keys;
  } catch {
    return [...DEFAULT_LANE_KEYS];
  }
}

export function clampPlaySettings(settings: PlaySettings): PlaySettings {
  return {
    scrollSpeed: Math.max(100, Math.min(1200, settings.scrollSpeed)),
    masterVolume: Math.max(0, Math.min(1, settings.masterVolume)),
    countdownSeconds: Math.max(0, Math.min(10, settings.countdownSeconds)),
    userOffsetMs: Math.max(-500, Math.min(500, settings.userOffsetMs)),
    laneKeys: parseLaneKeysJson(JSON.stringify(settings.laneKeys)),
    lastBeatmapId: settings.lastBeatmapId?.trim() || null,
  };
}

export function formatKeyLabel(key: string): string {
  if (key === "space") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

export function formatKeyBindingsHint(laneKeys: string[]): string {
  return laneKeys.map(formatKeyLabel).join(" ");
}
