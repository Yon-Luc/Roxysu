type ModEntry = { acronym?: string; settings?: Record<string, unknown> };

type TosuV2Payload = {
  error?: string;
  state?: { number?: number; name?: string };
  beatmap?: {
    checksum?: string;
    id?: number;
    set?: number;
    title?: string;
    artist?: string;
    version?: string;
    mode?: { number?: number; name?: string };
    stats?: { cs?: number | { original?: number; converted?: number } };
    time?: { live?: number };
  };
  play?: {
    mods?: {
      array?: ModEntry[] | string[];
      rate?: number | string;
      name?: string;
    };
  };
};

type TosuLegacyPayload = {
  error?: string;
  menu?: {
    gameMode?: number;
    state?: number;
    mods?: { num?: number; str?: string };
    bm?: {
      md5?: string;
      time?: { current?: number; firstObj?: number; full?: number };
      stats?: {
        AR?: number;
        CS?: number;
        OD?: number;
        HP?: number;
        BPM?: { realtime?: number; common?: number };
      };
      metadata?: {
        title?: string;
        artist?: string;
        difficulty?: string;
        mapper?: string;
      };
    };
  };
  play?: {
    mods?: { array?: ModEntry[] | string[]; rate?: number | string; name?: string };
  };
};

export type LiveFrame = {
  checksum: string | null;
  modeNumber: number | null;
  keys: number | null;
  acronyms: string[];
  rate: number;
  timeLiveMs: number | null;
  title: string | null;
  version: string | null;
  /** True when tosu reports gameplay (state 2 / name "play"). */
  playing: boolean;
};

function asFinite(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** osu! gameplay is tosu GameState.play = 2. */
export function isPlayingState(
  state: { number?: number; name?: string } | undefined,
  menuState?: number,
): boolean {
  if (typeof menuState === "number") return menuState === 2;
  if (asFinite(state?.number) === 2) return true;
  const name = state?.name;
  return typeof name === "string" && name.toLowerCase() === "play";
}

/** Mania key count from v2 `stats.cs` (object or number). Prefer converted when it's 1–10. */
export function keysFromCs(cs: unknown): number | null {
  if (typeof cs === "number") return asFinite(cs);
  if (!cs || typeof cs !== "object") return null;
  const o = cs as { original?: unknown; converted?: unknown };
  const converted = asFinite(o.converted);
  if (
    converted != null &&
    Number.isInteger(converted) &&
    converted >= 1 &&
    converted <= 10
  ) {
    return converted;
  }
  return asFinite(o.original);
}

/**
 * Effective playback rate: custom DT/HT speed_change wins, then tosu's
 * aggregated `mods.rate`, else 1.
 */
export function rateFromMods(mods: unknown): number {
  if (!mods || typeof mods !== "object") return 1;
  const m = mods as { array?: ModEntry[] | string[]; rate?: number | string };
  const arr = Array.isArray(m.array) ? m.array : [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const settings = entry.settings;
    if (!settings || typeof settings !== "object") continue;
    const raw =
      settings.speed_change != null
        ? settings.speed_change
        : settings.speedChange != null
          ? settings.speedChange
          : null;
    const n = typeof raw === "string" ? Number(raw) : raw;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
  }
  const top = typeof m.rate === "string" ? Number(m.rate) : m.rate;
  if (typeof top === "number" && Number.isFinite(top) && top > 0) return top;
  return 1;
}

function acronymsFromMods(mods: unknown): string[] {
  if (!mods || typeof mods !== "object") return [];
  const m = mods as { array?: ModEntry[] | string[]; name?: string };
  const arr = Array.isArray(m.array) ? m.array : [];
  const out: string[] = [];
  for (const entry of arr) {
    if (typeof entry === "string" && entry.trim()) out.push(entry.trim());
    else if (
      entry &&
      typeof entry === "object" &&
      typeof entry.acronym === "string" &&
      entry.acronym.trim()
    ) {
      out.push(entry.acronym.trim());
    }
  }
  if (out.length > 0) return out;
  const name = typeof m.name === "string" ? m.name.trim() : "";
  if (!name || name === "NM") return [];
  if (name.includes(",")) {
    return name
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return acronymsFromModString(name);
}

/**
 * Parse a legacy tosu mod string like "HDDT" into two-char acronyms.
 * Used for the lazer /json shape where mods arrive as a concatenated string.
 */
function acronymsFromModString(str: string): string[] {
  if (!str) return [];
  const out: string[] = [];
  for (let i = 0; i + 1 < str.length; i += 2) {
    out.push(str.slice(i, i + 2).toUpperCase());
  }
  return out;
}

/**
 * Derive approximate playback rate from a legacy mod string.
 * DT/NC → 1.5, HT → 0.75, else 1.
 */
function rateFromModString(str: string): number {
  if (!str) return 1;
  const upper = str.toUpperCase();
  if (upper.includes("DT") || upper.includes("NC")) return 1.5;
  if (upper.includes("HT")) return 0.75;
  return 1;
}

export function parseV2Data(data: unknown): LiveFrame | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as TosuV2Payload & TosuLegacyPayload;
  if (payload.error) return null;

  if (payload.menu?.bm) {
    const bm = payload.menu.bm;
    const checksum = bm.md5?.trim() || null;
    const modsStr = payload.menu.mods?.str ?? "";
    const meta = bm.metadata;
    return {
      checksum,
      modeNumber: asFinite(payload.menu.gameMode),
      keys: asFinite(bm.stats?.CS),
      acronyms: acronymsFromModString(modsStr),
      rate: rateFromModString(modsStr),
      timeLiveMs: asFinite(bm.time?.current),
      title: meta?.title?.trim() ? meta.title.trim() : null,
      version: meta?.difficulty?.trim() ? meta.difficulty.trim() : null,
      playing: isPlayingState(undefined, payload.menu.state),
    };
  }

  const bm = payload.beatmap;
  const checksum = bm?.checksum?.trim() ? bm.checksum.trim() : null;
  const title = bm?.title?.trim() ? bm.title.trim() : null;
  const version = bm?.version?.trim() ? bm.version.trim() : null;

  return {
    checksum,
    modeNumber: asFinite(bm?.mode?.number),
    keys: keysFromCs(bm?.stats?.cs),
    acronyms: acronymsFromMods(payload.play?.mods),
    rate: rateFromMods(payload.play?.mods),
    timeLiveMs: asFinite(bm?.time?.live),
    title,
    version,
    playing: isPlayingState(payload.state),
  };
}

/**
 * Parse a tosu `/websocket/v2` JSON message into the fields the counter uses.
 * Handles two payload shapes:
 *  - Legacy / lazer tosu: top-level `menu` object (same as /json endpoint)
 *  - Modern v2: top-level `beatmap` / `play` objects
 */
export function parseV2Frame(raw: string): LiveFrame | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseV2Data(data);
}

export type LiveStatus = "connecting" | "connected" | "disconnected";

const HTTP_FALLBACK_MS = 200;
const HTTP_STALE_MS = 1000;

async function decodeWsData(data: unknown): Promise<string | null> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    try {
      return await data.text();
    } catch {
      return null;
    }
  }
  if (data == null) return null;
  return String(data);
}

/**
 * Reconnecting WebSocket to tosu `/websocket/v2`. Host is derived from
 * `window.location` — the counter is always served by tosu itself.
 *
 * Current tosu ignores `?v=`; a silent socket means osu! is not hooked yet,
 * not a version mismatch. Keep the connection open and poll `/json/v2` until
 * the websocket starts delivering.
 */
export function connectLiveSocket(opts: {
  onFrame: (frame: LiveFrame) => void;
  onStatus: (status: LiveStatus) => void;
  onError?: () => void;
}): { stop: () => void } {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let httpTimer: ReturnType<typeof setInterval> | null = null;
  let attempt = 0;
  let lastWsFrameAt = 0;

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

  const handleFrame = (frame: LiveFrame, fromWs: boolean) => {
    if (fromWs) lastWsFrameAt = performance.now();
    opts.onFrame(frame);
  };

  const pollHttp = () => {
    if (stopped) return;
    if (lastWsFrameAt && performance.now() - lastWsFrameAt < HTTP_STALE_MS) {
      return;
    }
    void (async () => {
      try {
        const res = await fetch("/json/v2", {
          signal: AbortSignal.timeout(4_000),
        });
        if (!res.ok || stopped) return;
        const frame = parseV2Frame(await res.text());
        if (frame && !stopped) handleFrame(frame, false);
      } catch {
        // HTTP is a fallback; ignore failures
      }
    })();
  };

  const open = () => {
    if (stopped) return;
    clearReconnect();
    ws = null;
    const url = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/websocket/v2`;
    try {
      ws = new WebSocket(url);
    } catch {
      opts.onStatus("disconnected");
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      attempt = 0;
      opts.onStatus("connected");
    });

    ws.addEventListener("message", (event) => {
      void (async () => {
        const text = await decodeWsData(event.data);
        if (text == null || stopped) return;
        const frame = parseV2Frame(text);
        if (frame) {
          handleFrame(frame, true);
          return;
        }
        try {
          const parsed = JSON.parse(text) as { error?: unknown };
          if (parsed && typeof parsed === "object" && parsed.error) return;
        } catch {
          // not json
        }
      })();
    });

    ws.addEventListener("close", () => {
      opts.onStatus("disconnected");
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      opts.onError?.();
      if (ws && ws.readyState >= 2) scheduleReconnect();
    });
  };

  open();
  pollHttp();
  httpTimer = setInterval(pollHttp, HTTP_FALLBACK_MS);

  return {
    stop: () => {
      stopped = true;
      clearReconnect();
      if (httpTimer) {
        clearInterval(httpTimer);
        httpTimer = null;
      }
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
    },
  };
}
