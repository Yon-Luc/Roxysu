export type MasteryComputeInput = {
  beatmapId: string;
  playCount: number;
  bestAccuracy: number | null;
  bestPp: number | null;
  lastPlayedAt: Date | number | null;
};

export function clamp01to100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
