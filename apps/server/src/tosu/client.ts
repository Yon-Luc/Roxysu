import type { TosuLiveBeatmap, TosuLivePlay } from "./types";
import { parseScoreMods } from "../replay/mods";

type NumberName = { number?: number; name?: string };
type ModEntry = { acronym?: string; settings?: Record<string, unknown> };

type TosuV2Payload = {
  error?: string;
  state?: NumberName;
  beatmap?: {
    checksum?: string;
    id?: number;
    set?: number;
    title?: string;
    artist?: string;
    version?: string;
    mapper?: string;
    mode?: NumberName;
    stats?: {
      stars?: { total?: number } | number;
      cs?: number;
    };
  };
  play?: {
    accuracy?: number;
    score?: number;
    combo?: { current?: number; max?: number };
    hits?: Record<string, number | undefined>;
    mods?: {
      name?: string;
      array?: ModEntry[] | string[];
      rate?: number;
    };
    pp?: { current?: number };
  };
};

function asFinite(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function starFromStats(stats: unknown): number | null {
  if (!stats || typeof stats !== "object") return null;
  const stars = (stats as { stars?: { total?: number } | number }).stars;
  if (typeof stars === "number") return asFinite(stars);
  if (stars && typeof stars === "object") return asFinite(stars.total);
  return null;
}

function modsToJson(mods: unknown): string | null {
  if (!mods || typeof mods !== "object") return null;
  const m = mods as {
    name?: string;
    array?: ModEntry[] | string[];
    rate?: number;
  };
  const arr = m.array;
  if (!Array.isArray(arr) || arr.length === 0) {
    if (m.name && m.name.trim() && m.name !== "NM") {
      return JSON.stringify(
        m.name
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((acronym) => ({ acronym })),
      );
    }
    return "[]";
  }
  const entries = arr.map((entry) => {
    if (typeof entry === "string") return { acronym: entry };
    return {
      acronym: entry.acronym,
      settings: entry.settings,
    };
  });
  return JSON.stringify(entries);
}

/** Effective playback rate: prefer DT/HT speed_change, then tosu mods.rate. */
function rateFromMods(mods: unknown, modsJson: string | null): number {
  const fromSettings = parseScoreMods(modsJson).rate;
  if (mods && typeof mods === "object") {
    const raw = (mods as { rate?: unknown }).rate;
    const top =
      typeof raw === "number" && Number.isFinite(raw) && raw > 0
        ? raw
        : typeof raw === "string"
          ? Number(raw)
          : NaN;
    // If array settings include a custom speed_change, trust that over a stale
    // top-level rate (tosu may keep rate at the default DT 1.5 while scrubbing).
    const hasCustomSpeed = (() => {
      if (!modsJson) return false;
      try {
        const arr = JSON.parse(modsJson) as unknown;
        if (!Array.isArray(arr)) return false;
        return arr.some((entry) => {
          if (!entry || typeof entry !== "object") return false;
          const settings = (entry as { settings?: Record<string, unknown> })
            .settings;
          if (!settings) return false;
          return (
            settings.speed_change != null || settings.speedChange != null
          );
        });
      } catch {
        return false;
      }
    })();
    if (hasCustomSpeed) return fromSettings;
    if (Number.isFinite(top) && top > 0) return top;
  }
  return fromSettings;
}

function missCount(hits: unknown): number | null {
  if (!hits || typeof hits !== "object") return null;
  const h = hits as Record<string, unknown>;
  return asFinite(h["0"]);
}

export type ParsedTosuFrame = {
  beatmap: TosuLiveBeatmap;
  play: TosuLivePlay;
};

/** Parse a tosu `/websocket/v2` JSON message into a compact live frame. */
export function parseTosuV2Message(raw: string): ParsedTosuFrame | null {
  let data: TosuV2Payload;
  try {
    data = JSON.parse(raw) as TosuV2Payload;
  } catch {
    return null;
  }

  if (data.error) return null;

  const bm = data.beatmap;
  const stateName = data.state?.name ?? null;
  const stateNumber = asFinite(data.state?.number);
  const inPlay =
    stateNumber === 2 ||
    (typeof stateName === "string" && stateName.toLowerCase() === "play");

  const keys = asFinite(bm?.stats?.cs);
  const modsJson = modsToJson(data.play?.mods);
  const rate = rateFromMods(data.play?.mods, modsJson);

  const beatmap: TosuLiveBeatmap = {
    checksum: bm?.checksum?.trim() ? bm.checksum.trim() : null,
    onlineId: asFinite(bm?.id),
    setOnlineId: asFinite(bm?.set),
    title: bm?.title ?? null,
    artist: bm?.artist ?? null,
    version: bm?.version ?? null,
    mapper: bm?.mapper ?? null,
    mode: bm?.mode?.name ?? null,
    modeNumber: asFinite(bm?.mode?.number),
    keys,
    starRating: starFromStats(bm?.stats),
    mods: modsJson,
    rate,
    state: stateName,
    stateNumber,
  };

  const playRaw = data.play;
  let accuracy = inPlay ? asFinite(playRaw?.accuracy) : null;
  // Tosu often reports accuracy as 0–100; Roxysu formatters expect 0–1.
  if (accuracy != null && accuracy > 1) accuracy = accuracy / 100;

  const play: TosuLivePlay = {
    active: inPlay,
    accuracy,
    combo: inPlay ? asFinite(playRaw?.combo?.current) : null,
    maxCombo: inPlay ? asFinite(playRaw?.combo?.max) : null,
    misses: inPlay ? missCount(playRaw?.hits) : null,
    score: inPlay ? asFinite(playRaw?.score) : null,
    pp: inPlay ? asFinite(playRaw?.pp?.current) : null,
  };

  return { beatmap, play };
}

export type TosuWsHandlers = {
  onOpen: () => void;
  onClose: () => void;
  onError: () => void;
  onMessage: (frame: ParsedTosuFrame) => void;
};

export type TosuWsClient = {
  stop: () => void;
};

/**
 * Maintain a reconnecting WebSocket to tosu `/websocket/v2`.
 */
export function connectTosuWs(
  host: string,
  handlers: TosuWsHandlers,
): TosuWsClient {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    clearReconnect();
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
    attempt += 1;
    reconnectTimer = setTimeout(open, delay);
  };

  const open = () => {
    if (stopped) return;
    clearReconnect();
    try {
      ws?.close();
    } catch {
      // ignore
    }
    ws = null;

    const url = `ws://${host}/websocket/v2`;
    try {
      ws = new WebSocket(url);
    } catch {
      handlers.onError();
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      attempt = 0;
      handlers.onOpen();
    });

    ws.addEventListener("message", (event) => {
      const text =
        typeof event.data === "string"
          ? event.data
          : event.data instanceof ArrayBuffer
            ? new TextDecoder().decode(event.data)
            : String(event.data);
      const frame = parseTosuV2Message(text);
      if (frame) handlers.onMessage(frame);
    });

    ws.addEventListener("close", () => {
      handlers.onClose();
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      handlers.onError();
    });
  };

  open();

  return {
    stop: () => {
      stopped = true;
      clearReconnect();
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
    },
  };
}
