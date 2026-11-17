import { Elysia } from "elysia";
import { resolveListen, type ListenTarget } from "./listen";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function allowedOrigins(listen: ListenTarget): Set<string> {
  const port = listen.port;
  const origins = new Set<string>([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
  const host = listen.hostname;
  if (
    host !== "0.0.0.0" &&
    host !== "::" &&
    host !== "localhost" &&
    host !== "127.0.0.1" &&
    host !== "::1"
  ) {
    const bracket = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    origins.add(`http://${bracket}:${port}`);
  }
  return origins;
}

export function mutationOriginAllowed(input: {
  method: string;
  origin: string | null;
  listenHostname: string;
  listenPort: number;
  peerAddress: string | null;
}): boolean {
  if (!MUTATING.has(input.method.toUpperCase())) return true;
  const listen = { hostname: input.listenHostname, port: input.listenPort };
  if (input.origin) {
    let parsed: URL;
    try {
      parsed = new URL(input.origin);
    } catch {
      return false;
    }
    return allowedOrigins(listen).has(parsed.origin);
  }
  if (input.peerAddress && isLoopbackAddress(input.peerAddress)) return true;
  if (input.peerAddress == null && isLoopbackHostname(listen.hostname)) return true;
  return false;
}

function peerAddressOf(server: unknown, request: Request): string | null {
  const requestIP = (
    server as { requestIP?: (req: Request) => { address?: string } | null } | null
  )?.requestIP;
  if (typeof requestIP !== "function") return null;
  try {
    return requestIP(request)?.address ?? null;
  } catch {
    return null;
  }
}

/**
 * Browser mutations must come from this process's own UI origin.
 * A missing Origin (curl, the desktop shell's own fetches that omit it) is
 * allowed only from a loopback peer, or when the peer cannot be read and the
 * listen address is already loopback. No CORS headers are added.
 */
export function originGuard(listen: ListenTarget = resolveListen()) {
  return new Elysia({ name: "origin-guard" }).onBeforeHandle(
    ({ request, server, set }) => {
      const allowed = mutationOriginAllowed({
        method: request.method,
        origin: request.headers.get("origin"),
        listenHostname: listen.hostname,
        listenPort: listen.port,
        peerAddress: peerAddressOf(server, request),
      });
      if (allowed) return;
      set.status = 403;
      return { error: "Origin not allowed" };
    },
  );
}
