import type { Server } from "node:http";
import type { Duplex } from "node:stream";

/**
 * @elysiajs/node always installs a crossws upgrade handler, even when the app
 * declares no `.ws()` routes. A rejected handshake is answered by writing a
 * normal HTTP response onto the raw upgrade socket, and crossws' `sendResponse`
 * never listens for `error` — so a client that already hung up turns the write
 * into an unhandled `EPIPE` and kills the whole process. Upstream is unfixed,
 * so swallow the client-gone codes here instead of patching `node_modules`.
 */
const CLIENT_GONE_CODES = new Set(["EPIPE", "ECONNRESET", "ECONNABORTED"]);

const guardedServers = new WeakSet<Server>();

export function isClientDisconnectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code } = error as { code?: unknown };
  return typeof code === "string" && CLIENT_GONE_CODES.has(code);
}

function nodeHttpServerFrom(serveInfo: unknown): Server | null {
  const raw = (serveInfo as { raw?: { node?: { server?: Server } } } | null)?.raw;
  return raw?.node?.server ?? null;
}

/**
 * Attach a socket error handler to every HTTP upgrade socket. Runs before
 * crossws writes: `handleUpgrade` suspends on the upgrade hook before its first
 * `socket.write`, so a listener attached synchronously during the same `upgrade`
 * emit is always in place by then.
 *
 * Returns false when the Node HTTP server cannot be reached (guard not armed).
 */
export function guardUpgradeSocketErrors(
  serveInfo: unknown,
  log: (message: string, error: unknown) => void = (message, error) =>
    console.error(message, error),
): boolean {
  const server = nodeHttpServerFrom(serveInfo);
  if (!server) {
    log("[net] upgrade guard not armed — Node HTTP server unavailable", null);
    return false;
  }
  if (guardedServers.has(server)) return true;
  guardedServers.add(server);

  server.on("upgrade", (_request, socket: Duplex) => {
    socket.on("error", (error) => {
      if (isClientDisconnectError(error)) return;
      log("[net] upgrade socket error", error);
    });
  });

  return true;
}
