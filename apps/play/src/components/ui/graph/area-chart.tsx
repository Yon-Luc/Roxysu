import React from "react";
import type { StyleDesc } from "@gpuix/react";
import { colors } from "../theme";
import type { UiBaseProps } from "../lib/types";
import { extent, linearScale, ticks } from "../lib/graph/scales";
import { areaPath, linePath } from "../lib/graph/paths";

export interface AreaChartProps extends UiBaseProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  /** Draw horizontal reference lines at nice value intervals. */
  grid?: boolean;
}

/**
 * Filled line chart rendering static SVG markup. Sits on the graph substrate so
 * domain charts (ScoreGraph, DensityGraph) only supply data + colour.
 */
export function AreaChart({
  data,
  width = 240,
  height = 80,
  stroke = colors.primary,
  fill = "rgba(125, 211, 252, 0.12)",
  strokeWidth = 1.5,
  grid = false,
  style,
  testId,
}: AreaChartProps) {
  if (data.length === 0) {
    return <div style={style} testId={testId} />;
  }

  const [min, max] = extent(data);
  const yMin = Math.min(min, 0);
  const yMax = Math.max(max, 0);
  const padX = strokeWidth + 1;
  const padY = strokeWidth + 1;

  const x = linearScale([0, data.length - 1], [padX, width - padX], { clamp: true });
  const y = linearScale([yMin, yMax], [height - padY, padY], { clamp: true });
  const points = data.map((v, i) => [x(i), y(v)] as [number, number]);

  let gridMarkup = "";

  if (grid) {
    gridMarkup = ticks(yMin, yMax, 4)
      .map((t) => {
        const gy = y(t);
        return `<line x1="${padX}" y1="${gy}" x2="${width - padX}" y2="${gy}" stroke="${colors.border}" stroke-width="1" />`;
      })
      .join("");
  }

  const markup = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${gridMarkup}
  <path d="${areaPath(points, height - padY)}" fill="${fill}" stroke="none" />
  <path d="${linePath(points)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />
</svg>`;

  return <svg source={markup} style={{ width, height, ...style }} testId={testId} />;
}
