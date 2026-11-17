import { resolveHubBaseUrl } from "./hubUrl";
import { readResponseTextCapped } from "./readCappedText";

export const HUB_FETCH_TIMEOUT_MS = 15_000;
/** Ranked-best waits out the Hub's own pull deadline. */
export const HUB_RANKED_BEST_TIMEOUT_MS = 200_000;
export const HUB_BODY_MAX_BYTES = 16 * 1024 * 1024;

export class HubTimeoutError extends Error {
  constructor(message = "Hub did not respond") {
    super(message);
    this.name = "HubTimeoutError";
  }
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}

export async function hubFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = HUB_FETCH_TIMEOUT_MS,
  baseUrl = resolveHubBaseUrl(),
): Promise<Response> {
  const url = /^https?:\/\//i.test(path)
    ? path
    : `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeoutError(err)) throw new HubTimeoutError();
    throw err;
  }
}

/** JSON body, or `{}` when the body is empty or not JSON. Throws when it is too large. */
export async function readHubJson(
  res: Response,
  maxBytes = HUB_BODY_MAX_BYTES,
): Promise<unknown> {
  const text = await readResponseTextCapped(res, maxBytes);
  if (text == null) throw new Error("Hub response is too large");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}
