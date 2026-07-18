export type MasteryScoreInput = {
  accuracy: number;
  pp: number | null;
  playedAt: Date | number;
};

export type MasteryComputeInput = {
  beatmapId: string;
  playCount: number;
  bestAccuracy: number | null;
  bestPp: number | null;
  lastPlayedAt: Date | number | null;
  scores: MasteryScoreInput[];
  /** Max retry index across scores for this beatmap (0-based). */
  maxRetryIndex: number;
};

export type MasteryFormula = {
  id: string;
  label: string;
  description: string;
  compute(input: MasteryComputeInput): number;
};

export function clamp01to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
