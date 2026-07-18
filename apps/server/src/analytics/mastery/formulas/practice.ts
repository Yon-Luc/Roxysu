import { clamp01to100, type MasteryComputeInput, type MasteryFormula } from "../types";

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * practice — best accuracy + retry volume + consistency of recent plays.
 * Weights: acc 45%, retries 25%, consistency 30%.
 */
export const practiceFormula: MasteryFormula = {
  id: "practice",
  label: "Practice",
  description:
    "Best accuracy (45%), retry volume (25%), and recent accuracy consistency (30%).",
  compute(input: MasteryComputeInput): number {
    const acc = (input.bestAccuracy ?? 0) * 100;
    const retryScore = Math.min(100, (input.maxRetryIndex + 1) * 8);
    const recent = input.scores
      .slice()
      .sort((a, b) => {
        const ta = a.playedAt instanceof Date ? a.playedAt.getTime() : Number(a.playedAt);
        const tb = b.playedAt instanceof Date ? b.playedAt.getTime() : Number(b.playedAt);
        return tb - ta;
      })
      .slice(0, 10)
      .map((s) => s.accuracy * 100);
    // Low stddev → high consistency. Cap stddev contribution at ~15pp of acc.
    const consistency = clamp01to100(100 - stddev(recent) * 6);
    return clamp01to100(acc * 0.45 + retryScore * 0.25 + consistency * 0.3);
  },
};
