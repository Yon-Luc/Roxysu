import { useMemo } from "react";
import { useResolvedTheme } from "./theme";

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function useChartStyles() {
  const resolvedTheme = useResolvedTheme();

  return useMemo(
    () => ({
      tick: { fill: cssVar("--color-chart-tick"), fontSize: 11 },
      tooltip: {
        background: cssVar("--color-chart-tooltip-bg"),
        border: "1px solid var(--color-line)",
        borderRadius: 8,
        boxShadow: `0 8px 24px ${cssVar("--color-card-shadow")}`,
        color: cssVar("--color-ink"),
      },
      grid: cssVar("--color-line"),
      chart: cssVar("--color-chart"),
      chartAlt: cssVar("--color-chart-alt"),
      chartCons: cssVar("--color-chart-cons"),
      chartFln: cssVar("--color-chart-fln"),
    }),
    [resolvedTheme],
  );
}
