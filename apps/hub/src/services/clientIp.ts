export type RequestIpServer = {
  requestIP?: (request: Request) => { address: string } | null | undefined;
};

export function isHubTrustProxy(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.HUB_TRUST_PROXY === "1";
}

/**
 * Rate-limit identity.
 * Forwarded headers are ignored unless HUB_TRUST_PROXY=1 (reverse proxy
 * overwrites them). When trusted, X-Real-Ip wins; otherwise the last
 * X-Forwarded-For hop (closest to us), never the client-supplied first hop.
 */
export function resolveClientIp(opts: {
  trustProxy: boolean;
  forwardedFor: string | null;
  realIp: string | null;
  socketIp: string | null;
}): string {
  if (opts.trustProxy) {
    const real = opts.realIp?.trim();
    if (real) return real;
    const hops = (opts.forwardedFor ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  const socket = opts.socketIp?.trim();
  if (socket) return socket;
  return "unidentified";
}

export function clientIp(
  request: Request,
  server?: RequestIpServer | null,
): string {
  return resolveClientIp({
    trustProxy: isHubTrustProxy(),
    forwardedFor: request.headers.get("x-forwarded-for"),
    realIp: request.headers.get("x-real-ip"),
    socketIp: server?.requestIP?.(request)?.address ?? null,
  });
}
