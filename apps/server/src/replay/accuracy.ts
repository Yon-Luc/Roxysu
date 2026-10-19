/** Sum of per-judgment accuracy slices. Empty input is a perfect score. */
export function accuracyFromSlices(
  judgments: Array<{ accuracyPoints: number; accuracyMax: number }>,
): number {
  let points = 0;
  let max = 0;
  for (const j of judgments) {
    points += j.accuracyPoints;
    max += j.accuracyMax;
  }
  return max > 0 ? points / max : 1;
}
