import { memo, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatClock } from "../../lib/format";
import { useChartStyles } from "../../lib/chartStyles";
import { useAppDict, t } from "../../lib/i18n";
import { formatPatternLabel } from "./formatPatternLabel";
import type { ManiaDensitySampleView } from "./types";

export const DensityOverTimeChart = memo(function DensityOverTimeChart({
  samples,
  height = 320,
  gradientId = "mania-density-fill",
}: {
  samples: ManiaDensitySampleView[];
  height?: number;
  gradientId?: string;
}) {
  const { dict } = useAppDict();
  const detail = dict?.practice.detail;
  const charts = useChartStyles();
  const chartData = useMemo(
    () =>
      samples.map((sample) => ({
        ...sample,
        timeLabel: formatClock(sample.startMs),
        displayPattern: formatPatternLabel(
          sample.dominantPattern ?? "mixed",
          detail?.patterns,
        ),
        displaySecondary: sample.secondaryPattern
          ? formatPatternLabel(sample.secondaryPattern, detail?.patterns)
          : null,
      })),
    [samples, detail?.patterns],
  );

  return (
    <div className="rounded-xl border border-white/8 bg-black/10 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-ink">
            {detail?.densityOverTime}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {detail?.densityOverTimeHint}
          </p>
        </div>
        <div className="text-right text-xs text-faint">
          {t(detail?.samplesCount, {
            count: samples.length.toLocaleString(),
          })}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={charts.chart} stopOpacity={0.45} />
              <stop offset="100%" stopColor={charts.chart} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={charts.grid} vertical={false} />
          <XAxis
            dataKey="timeLabel"
            tick={charts.tick}
            axisLine={false}
            tickLine={false}
            minTickGap={36}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={charts.tick}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={charts.tooltip}
            labelFormatter={(_, payload) => {
              const sample = payload?.[0]?.payload as
                | ManiaDensitySampleView
                | undefined;
              return sample
                ? `${formatClock(sample.startMs)} - ${formatClock(sample.endMs)}`
                : "";
            }}
            formatter={(value, name, item) => {
              if (name === "notesPerSecond") {
                return [
                  `${Number(value).toFixed(1)} NPS`,
                  detail?.tooltipDensity ?? "Density",
                ];
              }
              if (name === "peakChordSize") {
                return [
                  `${value}K`,
                  detail?.tooltipPeakChord ?? "Peak chord",
                ];
              }
              const payload = item.payload as (typeof chartData)[number];
              if (name === "displayPattern") {
                return [
                  payload.displaySecondary
                    ? `${payload.displayPattern} + ${payload.displaySecondary}`
                    : payload.displayPattern,
                  detail?.tooltipPattern ?? "Pattern",
                ];
              }
              return [String(value), String(name)];
            }}
          />
          <Area
            type="monotone"
            dataKey="notesPerSecond"
            stroke={charts.chart}
            fill={`url(#${gradientId})`}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});
