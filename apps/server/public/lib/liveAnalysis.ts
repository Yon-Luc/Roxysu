import type { QueryFunctionContext } from "@tanstack/react-query";
import { fetchTosuLiveAnalysis } from "./api";

/** True when the analysis payload was built for the map the query asked for. */
export function liveAnalysisMatches(
  payload: { checksum: string | null } | null | undefined,
  expectedChecksum: string | null,
): boolean {
  return Boolean(
    expectedChecksum &&
      payload?.checksum &&
      payload.checksum === expectedChecksum,
  );
}

export function selectLivePatternDetail<T>(
  payload: { checksum: string | null; detail: T | null } | undefined,
  expectedChecksum: string | null,
): T | null {
  if (!liveAnalysisMatches(payload, expectedChecksum)) return null;
  return payload?.detail ?? null;
}

export const LIVE_ANALYSIS_MISMATCH = "tosu analysis checksum mismatch";

/** Fetch live analysis and refuse to cache a payload for a different map. */
export async function queryTosuLiveAnalysis(
  ctx: Pick<QueryFunctionContext, "signal" | "queryKey">,
) {
  const expected = typeof ctx.queryKey[3] === "string" ? ctx.queryKey[3] : null;
  const payload = await fetchTosuLiveAnalysis(ctx.signal);
  if (ctx.signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  if (!liveAnalysisMatches(payload, expected)) {
    throw new Error(LIVE_ANALYSIS_MISMATCH);
  }
  return payload;
}

export function retryLiveAnalysis(failureCount: number, error: Error): boolean {
  if (error.message === LIVE_ANALYSIS_MISMATCH) return false;
  return failureCount < 1;
}
