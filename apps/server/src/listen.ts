export const DEFAULT_LISTEN_PORT = 4321;
export const DEFAULT_LISTEN_HOSTNAME = "127.0.0.1";

export type ListenTarget = {
  port: number;
  hostname: string;
};

export type ListenSocket = {
  listening: boolean;
  on(event: "error", listener: (err: unknown) => void): unknown;
  once(event: "listening", listener: () => void): unknown;
};

/**
 * Port and host for both entry points. Default is IPv4 loopback.
 * `localhost` is not used: on Bun that name can still open every interface.
 */
export function resolveListen(env: NodeJS.ProcessEnv = process.env): ListenTarget {
  const rawPort = (env.ROXYSU_PORT ?? env.PORT ?? "").trim();
  const portText = rawPort || String(DEFAULT_LISTEN_PORT);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port ${portText} (ROXYSU_PORT)`);
  }
  const hostname =
    (env.ROXYSU_HOST ?? "").trim() || DEFAULT_LISTEN_HOSTNAME;
  return { port, hostname };
}

/** Operator-facing warning when the unauthenticated API is not loopback-only. */
export function listenExposureWarning(hostname: string): string | null {
  if (hostname === "0.0.0.0" || hostname === "::") {
    return `[net] ROXYSU_HOST=${hostname} exposes the unauthenticated API on the network. Do not do this without adding auth.`;
  }
  if (hostname === "localhost") {
    return "[net] ROXYSU_HOST=localhost is not treated as loopback-only. Bind 127.0.0.1 or ::1.";
  }
  return null;
}

export function warnIfListenExposed(
  hostname: string,
  log: (message: string) => void = (message) => console.warn(message),
): void {
  const message = listenExposureWarning(hostname);
  if (message) log(message);
}

export function listenUrl(target: ListenTarget): string {
  const host =
    target.hostname.includes(":") && !target.hostname.startsWith("[")
      ? `[${target.hostname}]`
      : target.hostname;
  return `http://${host}:${target.port}`;
}

export function addrInUseMessage(port: number): string {
  return `port ${port} is already in use (ROXYSU_PORT)`;
}

export function isAddrInUseError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === "EADDRINUSE") return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /EADDRINUSE|address already in use|port .* in use/i.test(message);
}

export function nodeServerFromListenInfo(serveInfo: unknown): ListenSocket | null {
  const raw = (serveInfo as { raw?: { node?: { server?: ListenSocket } } } | null)
    ?.raw;
  return raw?.node?.server ?? null;
}

/**
 * Print a clear message and exit on EADDRINUSE. Call `onListening` only after
 * the socket is bound, so background work does not start on a failed listen.
 * If the Node server cannot be reached, start anyway — the adapter shape is
 * the only signal we have.
 */
export function armNodeListen(
  serveInfo: unknown,
  port: number,
  onListening: () => void,
  exit: (code: number) => void = (code) => process.exit(code),
  log: (message: string) => void = (message) => console.error(message),
): void {
  const server = nodeServerFromListenInfo(serveInfo);
  if (!server) {
    log("[net] could not watch the listen socket — starting anyway");
    onListening();
    return;
  }
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    onListening();
  };
  server.on("error", (err) => {
    if (!isAddrInUseError(err)) {
      log(`[net] server error ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    log(addrInUseMessage(port));
    exit(1);
  });
  if (server.listening) {
    start();
    return;
  }
  server.once("listening", start);
}
