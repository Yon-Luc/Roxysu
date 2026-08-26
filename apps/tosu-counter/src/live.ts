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
    mods?: { array?: ModEntry[] | string[]; rate?: number | string };
  };
};

// Legacy lazer tosu shape (what /json and the v2 socket actually send for lazer)
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
    else if (
      entry &&
      typeof entry === "object" &&
      typeof entry.acronym === "string" &&
      entry.acronym.trim()
    ) {
      out.push(entry.acronym.trim());
    }
  }
  return out;
}

/**
 * Parse a legacy tosu mod string like "HDDT" into two-char acronyms.
 * Used for the lazer /json shape where mods arrive as a concatenated string.
 */
function acronymsFromModString(str: string): string[] {
  if (!str) return [];
  const out: string[] = [];
  // Standard two-char osu! mod acronyms
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

/**
 * Parse a tosu `/websocket/v2` JSON message into the fields the counter uses.
 * Handles two payload shapes:
 *  - Legacy / lazer tosu: top-level `menu` object (same as /json endpoint)
 *  - Modern v2 (stable tosu): top-level `beatmap` / `play` objects
 */
export function parseV2Frame(raw: string): LiveFrame | null {
  let data: TosuV2Payload & TosuLegacyPayload;
  try {
    data = JSON.parse(raw) as TosuV2Payload & TosuLegacyPayload;
  } catch {
    return null;
  }
  if (data.error) return null;

  // ── Legacy / lazer shape ─────────────────────────────────────────────────
  // Detected by the presence of `menu.bm` (the /json structure).
  if (data.menu?.bm) {
    const bm = data.menu.bm;
    const checksum = bm.md5?.trim() || null;
    const keys = asFinite(bm.stats?.CS);
    const modsStr = data.menu.mods?.str ?? "";
    return {
      checksum,
      modeNumber: asFinite(data.menu.gameMode),
      keys,
      acronyms: acronymsFromModString(modsStr),
      rate: rateFromModString(modsStr),
      timeLiveMs: asFinite(bm.time?.current),
    };
  }

  // ── Modern v2 shape ──────────────────────────────────────────────────────
  // tosu v2 reports mania columns as `stats.cs: { original, converted }`
  // (an object), not a bare number — read both shapes so keymode detection
  // from the live feed works.
  const bm = data.beatmap;
  const checksum = bm?.checksum?.trim() ? bm.checksum.trim() : null;
  const cs = bm?.stats?.cs;
  const csObj =
    cs && typeof cs === "object"
      ? (cs as { original?: unknown; converted?: unknown })
      : null;
  const keys =
    asFinite(csObj?.original) ?? asFinite(csObj?.converted) ?? asFinite(cs);

  return {
    checksum,
    modeNumber: asFinite(bm?.mode?.number),
    keys,
    acronyms: acronymsFromMods(data.play?.mods),
    rate: rateFromMods(data.play?.mods),
    timeLiveMs: asFinite(bm?.time?.live),
  };
}

export type LiveStatus = "connecting" | "connected" | "disconnected";

/**
 * Reconnecting WebSocket to tosu `/websocket/v2`. Host is derived from
 * `window.location` — the counter is always served by tosu itself.
 *
 * tosu negotiates the v2 structure by an optional `?v=` query: with no `v` it
 * falls back to the *first* v2 version, whose shape can differ from the
 * current docs and yield frames our parser drops (a socket that opens but
 * never delivers usable data). We try a set of versions and, if none deliver
 * a frame within a few seconds, rotate to the next candidate.
 */
export function connectLiveSocket(opts: {
  onFrame: (frame: LiveFrame) => void;
  onStatus: (status: LiveStatus) => void;
  onError?: () => void;
}): { stop: () => void } {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let frameWatch: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let variant = 0;
  // Pinned versions first (modern shape), then unversioned (tosu's latest).
  const variants = ["?v=7", "?v=6", "?v=5", ""];

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const clearFrameWatch = () => {
    if (frameWatch) {
      clearTimeout(frameWatch);
      frameWatch = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    clearReconnect();
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
    attempt += 1;
    variant = (variant + 1) % variants.length;
    reconnectTimer = setTimeout(open, delay);
  };

  const open = () => {
    if (stopped) return;
    clearReconnect();
    clearFrameWatch();
    ws = null;
    const base = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/websocket/v2`;
    const url = base + variants[variant]!;
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
      // If this variant never yields a usable frame, rotate to the next one.
      clearFrameWatch();
      frameWatch = setTimeout(() => {
        if (ws && ws.readyState <= 1) {
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
      }, 4000);
    });

    ws.addEventListener("message", (event) => {
      const text =
        typeof event.data === "string"
          ? event.data
          : event.data instanceof ArrayBuffer
            ? new TextDecoder().decode(event.data)
            : String(event.data);
      const frame = parseV2Frame(text);
      if (frame) {
        clearFrameWatch();
        opts.onFrame(frame);
      } else if (
        text.includes("beatmap") ||
        text.includes("menu") ||
        text.includes("error")
      ) {
        // Frame arrived but our parser rejected it — surface it for debugging
        // (structure/version mismatch vs. a silent/empty socket).
        console.warn(
          `[roxysu] v2 frame (variant "${variants[variant]}") dropped:`,
          text.slice(0, 200),
        );
      }
    });

    ws.addEventListener("close", () => {
      opts.onStatus("disconnected");
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      opts.onError?.();
      // Some environments fire `error` then `close`; only reconnect if the
      // socket is actually gone.
      if (ws && ws.readyState >= 2) scheduleReconnect();
    });
  };

  open();

  return {
    stop: () => {
      stopped = true;
      clearReconnect();
      clearFrameWatch();
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
    },
  };
}
