/** Max score rows drawn on a session share card. */
export const SESSION_SHARE_HIGHLIGHT_CAP = 8;

export type SessionShareScoreLike = {
  id: string;
  isPb: boolean | null | undefined;
  pp: number | null | undefined;
};

function ppDesc(
  a: SessionShareScoreLike,
  b: SessionShareScoreLike,
): number {
  const ap = a.pp;
  const bp = b.pp;
  if (ap == null && bp == null) return 0;
  if (ap == null) return 1;
  if (bp == null) return -1;
  return bp - ap;
}

/**
 * Pick highlight scores for a session share card: PBs by PP first, then
 * fill remaining slots with non-PBs by PP. Cap at {@link SESSION_SHARE_HIGHLIGHT_CAP}.
 */
export function pickSessionShareHighlights<T extends SessionShareScoreLike>(
  scores: readonly T[],
  cap: number = SESSION_SHARE_HIGHLIGHT_CAP,
): T[] {
  if (cap <= 0 || scores.length === 0) return [];

  const pbs = scores.filter((s) => Boolean(s.isPb)).sort(ppDesc);
  const nonPbs = scores.filter((s) => !s.isPb).sort(ppDesc);

  const out: T[] = [];
  const seen = new Set<string>();

  for (const score of pbs) {
    if (out.length >= cap) break;
    if (seen.has(score.id)) continue;
    seen.add(score.id);
    out.push(score);
  }
  for (const score of nonPbs) {
    if (out.length >= cap) break;
    if (seen.has(score.id)) continue;
    seen.add(score.id);
    out.push(score);
  }

  return out;
}

/** Format session duration for UI and share cards (e.g. `45m`, `1h 20m`). */
export function formatSessionDuration(
  startedAt: string,
  endedAt: string | null,
  nowMs: number = Date.now(),
): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : nowMs;
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}
