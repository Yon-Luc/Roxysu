/**
 * tosu dashboard settings integration.
 *
 * Protocol (reverse-engineered from tosuapp/tosu packages/server):
 * - Connect to `ws://<host>/websocket/commands?l=<encodeURIComponent(counterName)>`
 *   where counterName is the counter's bare folder name, e.g. `RoxysuPreview`
 *   (no slashes — tosu joins this string into its values-file path
 *   `<config>/settings/<name>.values.json`, so a slashed URL path like
 *   `/RoxysuPreview/` becomes a bogus `<name>/.values.json` subdirectory and
 *   every settings read/write fails with ENOENT).
 * - Send text frame `getSettings:<same encoded name>`; the reply arrives as
 *   JSON `{ command: "getSettings", message: Record<uniqueID, value> }`
 *   (message values come from tosu's saved `settings.values.json`).
 * - Dashboard edits are broadcast as `updateSettings:<name>:<payload>` text
 *   frames, payload being a `{uniqueID, value}[]` array or a values record.
 */

export type TosuSettingsFrame = Record<string, unknown>;

/** Pure parser for both reply shapes — unit-tested. */
export function parseSettingsFrame(
  data: unknown,
  counterName: string,
): TosuSettingsFrame | null {
  if (typeof data === "string") {
    if (!data.startsWith("updateSettings:")) return null;
    const rest = data.slice("updateSettings:".length);
    const sep = rest.indexOf(":");
    const overlay = sep >= 0 ? rest.slice(0, sep) : rest;
    if (decodeURIComponent(overlay) !== decodeURIComponent(counterName)) {
      return null;
    }
    const payload = sep >= 0 ? rest.slice(sep + 1) : "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload || "null");
    } catch {
      return null;
    }
    return normalizeValues(parsed);
  }

  if (data && typeof data === "object") {
    const frame = data as { command?: unknown; message?: unknown };
    if (frame.command !== "getSettings") return null;
    const message = frame.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return null;
    }
    if ("error" in (message as Record<string, unknown>)) return null;
    return normalizeValues(message);
  }
  return null;
}

function normalizeValues(parsed: unknown): TosuSettingsFrame | null {
  // Dashboard saves broadcast [{uniqueID, value}, …]; getSettings returns a
  // Record<uniqueID, value>. Normalize to a record either way.
  if (Array.isArray(parsed)) {
    const out: TosuSettingsFrame = {};
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { uniqueID?: unknown }).uniqueID === "string"
      ) {
        out[(entry as { uniqueID: string }).uniqueID] = (
          entry as { value?: unknown }
        ).value;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  if (parsed && typeof parsed === "object") {
    return parsed as TosuSettingsFrame;
  }
  return null;
}

export function counterPath(): string {
  const pathname = window.location.pathname;
  if (pathname.endsWith("/")) return pathname;
  if (pathname.endsWith("/index.html")) {
    return pathname.slice(0, -"index.html".length);
  }
  return `${pathname}/`;
}

/**
 * Bare folder name tosu expects in the commands websocket (`?l=`) and
 * updateSettings frames. Never contains slashes: tosu concatenates it into
 * `settings/<name>.values.json`, so `/RoxysuPreview/` would turn into a
 * non-existent `<name>/.values.json` sub-path and fail with ENOENT.
 */
export function counterName(): string {
  return counterPath().replace(/^\/+|\/+$/g, "");
}

export function connectTosuSettings(opts: {
  onValues: (values: TosuSettingsFrame) => void;
}): { stop: () => void } {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  const name = counterName();
  const encoded = encodeURIComponent(name);

  const clearReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    clearReconnect();
    attempt += 1;
    reconnectTimer = setTimeout(open, Math.min(30_000, 2_000 * attempt));
  };

  const open = () => {
    if (stopped) return;
    clearReconnect();
    ws = null;
    const proto =
      window.location.protocol === "https:" ? "wss:" : "ws:";
    try {
      ws = new WebSocket(
        `${proto}//${window.location.host}/websocket/commands?l=${encoded}`,
      );
    } catch {
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      attempt = 0;
      try {
        ws?.send(`getSettings:${encoded}`);
      } catch {
        // retry on next reconnect
      }
    });

    ws.addEventListener("message", (event) => {
      let parsed: unknown = event.data;
      if (typeof event.data === "string") {
        try {
          parsed = JSON.parse(event.data);
        } catch {
          parsed = event.data; // updateSettings frames are raw strings
        }
      }
      const values = parseSettingsFrame(parsed, name);
      if (values) opts.onValues(values);
    });

    ws.addEventListener("close", () => scheduleReconnect());
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
