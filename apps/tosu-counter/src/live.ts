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
    stats?: { cs?: number };
    time?: { live?: number };
  };
  play?: {
    mods?: { array?: ModEntry[] | string[]; rate?: number | string };
  };
};

export type LiveFrame = {
  checksum: string | null;
  modeNumber: number | null;
  keys: number | null;
  acronyms: string[];
  rate: number;
  timeLiveMs: number | null;
};

function asFinite(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
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
  const m = mods as { array?: ModEntry[] | string[] };
  const arr = Array.isArray(m.array) ? m.array : [];
  const out: string[] = [];
  for (const entry of arr) {
    if (typeof entry === "string" && entry.trim()) out.push(entry.trim());
    else if (entry && typeof entry === "object" && typeof entry.acronym === "string" && entry.acronym.trim()) {
      out.push(entry.acronym.trim());
    }
  }
  return out;
}

/** Parse a tosu `/websocket/v2` JSON message into the fields the counter uses. */
export function parseV2Frame(raw: string): LiveFrame | null {
  let data: TosuV2Payload;
  try {
    data = JSON.parse(raw) as TosuV2Payload;
  } catch {
    return null;
  }
  if (data.error) return null;

  const bm = data.beatmap;
  const checksum = bm?.checksum?.trim() ? bm.checksum.trim() : null;

  return {
    checksum,
    modeNumber: asFinite(bm?.mode?.number),
    keys: asFinite(bm?.stats?.cs),
    acronyms: acronymsFromMods(data.play?.mods),
    rate: rateFromMods(data.play?.mods),
    timeLiveMs: asFinite(bm?.time?.live),
  };
}

export type LiveStatus = "connecting" | "connected" | "disconnected";

/**
 * Reconnecting WebSocket to tosu `/websocket/v2`. Host is derived from
 * `window.location` — the counter is always served by tosu itself.
 */
export function connectLiveSocket(opts: {
  onFrame: (frame: LiveFrame) => void;
  onStatus: (status: LiveStatus) => void;
}): { stop: () => void } {
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
      const text =
        typeof event.data === "string"
          ? event.data
          : event.data instanceof ArrayBuffer
            ? new TextDecoder().decode(event.data)
            : String(event.data);
      const frame = parseV2Frame(text);
      if (frame) opts.onFrame(frame);
    });
    ws.addEventListener("close", () => {
      opts.onStatus("disconnected");
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {});
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
