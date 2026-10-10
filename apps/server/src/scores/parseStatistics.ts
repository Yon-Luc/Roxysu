export type ScoreJudgments = {
  perfect: number;
  great: number;
  good: number;
  ok: number;
  meh: number;
  miss: number;
};

const JUDGMENT_KEYS = [
  "perfect",
  "great",
  "good",
  "ok",
  "meh",
  "miss",
] as const;

function readCount(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return 0;
}

/** Parse lazer `scores.statistics` JSON into judgment counts. */
export function parseScoreStatistics(
  statistics: string | null | undefined,
): ScoreJudgments | null {
  if (statistics == null || statistics === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(statistics);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const raw = parsed as Record<string, unknown>;
  const judgments: ScoreJudgments = {
    perfect: readCount(raw, "perfect"),
    great: readCount(raw, "great"),
    good: readCount(raw, "good"),
    ok: readCount(raw, "ok"),
    meh: readCount(raw, "meh"),
    miss: readCount(raw, "miss"),
  };
  const hasAny = JUDGMENT_KEYS.some((key) => judgments[key] > 0);
  // Still return zeros when the object had judgment keys (all-marvelous / empty play).
  const hasKey = JUDGMENT_KEYS.some((key) => key in raw);
  if (!hasAny && !hasKey) return null;
  return judgments;
}
