import { clamp01to100, type MasteryComputeInput } from "../types";

/**
 * Fixed mastery blend: best accuracy, log-scaled play count, and best PP.
 * Weights: acc 50%, play volume 25%, pp 25%.
 */
export function computeSimpleMastery(input: MasteryComputeInput): number {
  const acc = (input.bestAccuracy ?? 0) * 100; // accuracy stored 0–1
  const playScore = Math.min(100, Math.log10(input.playCount + 1) * 50);
  const ppScore = Math.min(100, (input.bestPp ?? 0) / 5); // ~500pp → 100
  return clamp01to100(acc * 0.5 + playScore * 0.25 + ppScore * 0.25);
}
