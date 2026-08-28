import React from "react";
import type { StyleDesc } from "@gpuix/react";
import { colors } from "../theme";
import type { UiBaseProps } from "../lib/types";
import { extent, linearScale } from "../lib/graph/scales";
import { areaPath, linePath } from "../lib/graph/paths";

export interface SparklineProps extends UiBaseProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
}

/**
 * Tiny inline trend line (line + soft fill) rendered as static SVG markup.
 * The reusable building block for compact metrics (accuracy trend, density).
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  stroke = colors.primary,
  fill = "rgba(125, 211, 252, 0.15)",
  strokeWidth = 1.5,
  style,
  testId,
}: SparklineProps) {
  if (data.length === 0) {
    return <div style={style} testId={testId} />;
  }

  const [min, max] = extent(data);
  const pad = strokeWidth + 1;
  const x = linearScale([0, data.length - 1], [pad, width - pad], { clamp: true });
  const y = linearScale([min, max], [height - pad, pad], { clamp: true });
  const points = data.map((v, i) => [x(i), y(v)] as [number, number]);

  const markup = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <path d="${areaPath(points, height - pad)}" fill="${fill}" stroke="none" />
  <path d="${linePath(points)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />
</svg>`;

  return <svg source={markup} style={{ width, height, ...style }} testId={testId} />;
}
