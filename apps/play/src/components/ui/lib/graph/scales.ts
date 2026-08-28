export type Domain = [number, number];
export type Range = [number, number];

/** [min, max] of a list of numbers. Falls back to [0, 1] for empty input. */
export function extent(values: number[]): Domain {
  if (values.length === 0) {
    return [0, 1];
  }

  let min = Infinity;
  let max = -Infinity;

  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  return [min, max];
}

/**
 * Linear map from `domain` to `range`. With `clamp`, values outside the domain
 * are pinned to the range edges (useful for pixel space).
 */
export function linearScale(
  domain: Domain,
  range: Range,
  options: { clamp?: boolean } = {},
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;

  return (value: number) => {
    let t = (value - d0) / span;

    if (options.clamp) {
      t = Math.max(0, Math.min(1, t));
    }

    return r0 + t * (r1 - r0);
  };
}

/** Human-friendly tick values across [min, max] (1/2/5 * 10^n steps). */
export function ticks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    return [min];
  }

  const span = max - min;
  const step0 = span / Math.max(count, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;

  let step: number;

  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;

  step *= mag;

  const start = Math.ceil(min / step) * step;
  const out: number[] = [];

  for (let v = start; v <= max + step * 1e-9; v += step) {
    out.push(Math.round(v / step) * step);
  }

  return out;
}

export interface BandScale {
  (index: number): number;
  bandwidth: number;
}

/**
 * Evenly spaced bands across `range`, each with an inner `bandwidth` leaving
 * `padding` of whitespace on both sides. Drives bar charts.
 */
export function bandScale(count: number, range: Range, padding = 0.2): BandScale {
  const [r0, r1] = range;
  const total = r1 - r0;
  const step = total / Math.max(count, 1);
  const bandwidth = step * (1 - padding);
  const offset = (step - bandwidth) / 2;

  const scale = ((index: number) => r0 + index * step + offset) as BandScale;
  scale.bandwidth = bandwidth;

  return scale;
}
