const DAN_MEANS: Array<[number, string]> = [
  [6.562, "Alpha"],
  [6.957, "Beta"],
  [7.459, "Gamma"],
  [7.939, "Delta"],
  [9.095, "Epsilon"],
  [9.473, "Emik Zeta"],
  [10.162, "Thaumiel Eta"],
  [10.782, "CloverWisp Theta"],
];

const DAN_ORDER_START = 11;

function precomputeDanBoundaries(): Array<[number, number]> {
  const means = DAN_MEANS.map(([mean]) => mean);
  const boundaries: Array<[number, number]> = [];

  for (let i = 0; i < DAN_MEANS.length; i += 1) {
    const mean = means[i]!;
    const lower =
      i > 0
        ? (means[i - 1]! + mean) / 2
        : mean - ((means[1]! + mean) / 2 - mean);
    const upper =
      i < means.length - 1
        ? (mean + means[i + 1]!) / 2
        : mean + (mean - means[i - 1]!) / 2;
    boundaries.push([lower, upper]);
  }

  return boundaries;
}

const DAN_BOUNDARIES = precomputeDanBoundaries();

export type DanielDanEstimate = {
  label: string;
  numeric: number | null;
};

/** Map Daniel star rating → Reform Alpha+ dan tier label and numeric order. */
export function estimateDanielDan(sr: number): DanielDanEstimate {
  if (!Number.isFinite(sr)) {
    return { label: "Unknown", numeric: null };
  }

  if (sr < DAN_BOUNDARIES[0]![0]) {
    return { label: `< ${DAN_MEANS[0]![1]} Low`, numeric: null };
  }

  if (sr >= DAN_BOUNDARIES[DAN_BOUNDARIES.length - 1]![1]) {
    return {
      label: `> ${DAN_MEANS[DAN_MEANS.length - 1]![1]} High`,
      numeric: null,
    };
  }

  for (let i = 0; i < DAN_MEANS.length; i += 1) {
    const [lower, upper] = DAN_BOUNDARIES[i]!;
    if (sr >= lower && sr < upper) {
      const tRaw = (sr - lower) / (upper - lower);
      const t = Math.max(0, Math.min(tRaw, 1));
      const numeric = Number((DAN_ORDER_START + i + t).toFixed(2));

      let label: string;
      if (t < 1 / 3) {
        label = `${DAN_MEANS[i]![1]} Low`;
      } else if (t < 2 / 3) {
        label = `${DAN_MEANS[i]![1]} Mid`;
      } else {
        label = `${DAN_MEANS[i]![1]} High`;
      }

      return { label, numeric };
    }
  }

  return { label: "Unknown", numeric: null };
}
