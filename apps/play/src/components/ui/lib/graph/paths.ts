/** Round to 2 decimals so generated SVG path strings stay compact. */
export function fmt(n: number): number {
  return Math.round(n * 100) / 100;
}

export type Point = [number, number];

/** Polyline through `points` (no fill). */
export function linePath(points: Point[]): string {
  if (points.length === 0) {
    return "";
  }

  let d = `M ${fmt(points[0][0])} ${fmt(points[0][1])}`;

  for (let i = 1; i < points.length; i++) {
    d += ` L ${fmt(points[i][0])} ${fmt(points[i][1])}`;
  }

  return d;
}

/**
 * Closed area from `points` down to `baselineY` and back. Used for filled
 * charts; `baselineY` is usually the chart bottom (y for value 0).
 */
export function areaPath(points: Point[], baselineY: number): string {
  if (points.length === 0) {
    return "";
  }

  const first = points[0];
  const last = points[points.length - 1];

  let d = `M ${fmt(first[0])} ${fmt(baselineY)}`;
  d += ` L ${fmt(first[0])} ${fmt(first[1])}`;

  for (let i = 1; i < points.length; i++) {
    d += ` L ${fmt(points[i][0])} ${fmt(points[i][1])}`;
  }

  d += ` L ${fmt(last[0])} ${fmt(baselineY)} Z`;

  return d;
}

/** `<rect>` markup for a single bar. */
export function barRect(x: number, y: number, width: number, height: number, fill: string): string {
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" fill="${fill}" />`;
}
