import { formatClock } from "../../lib/format";
import { useAppDict, t } from "../../lib/i18n";
import { formatPatternLabel } from "./formatPatternLabel";
import type { ManiaHotspotView } from "./types";

export function HotspotsList({ hotspots }: { hotspots: ManiaHotspotView[] }) {
  const { dict } = useAppDict();
  const detail = dict?.practice.detail;

  return (
    <div className="rounded-xl border border-white/8 bg-black/10 p-4">
      <h3 className="text-sm font-bold text-ink">{detail?.hotspots}</h3>
      {hotspots.length === 0 ? (
        <p className="mt-3 text-sm text-faint">{detail?.noDenseSections}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {hotspots.map((hotspot) => (
            <li
              key={`${hotspot.startMs}-${hotspot.endMs}`}
              className="rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink">
                  {formatClock(hotspot.startMs)} - {formatClock(hotspot.endMs)}
                </span>
                <span className="text-xs font-bold tabular-nums text-accent">
                  {hotspot.notesPerSecond.toFixed(1)} NPS
                </span>
              </div>
              <div className="mt-1 text-xs text-muted">
                {formatPatternLabel(
                  hotspot.dominantPattern ?? "mixed",
                  detail?.patterns,
                )}
                {hotspot.secondaryPattern
                  ? ` + ${formatPatternLabel(
                      hotspot.secondaryPattern,
                      detail?.patterns,
                    )}`
                  : ""}
                {hotspot.dominantCoverage > 0
                  ? t(detail?.coveragePct, {
                      pct: Math.round(hotspot.dominantCoverage * 100),
                    })
                  : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
