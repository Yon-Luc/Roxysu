import { formatPanelDuration } from "../../lib/format";
import { useChartStyles } from "../../lib/chartStyles";
import { useAppDict } from "../../lib/i18n";
import { DensityOverTimeChart } from "./DensityOverTimeChart";
import { formatPatternLabel } from "./formatPatternLabel";
import { HotspotsList } from "./HotspotsList";
import { PatternWeightsPanel } from "./PatternWeightsPanel";
import type { ManiaPatternDetailView } from "./types";

export function ManiaPatternDetailPanel({
  beatmapLengthMs,
  keyCount,
  bpm,
  analysis,
}: {
  beatmapLengthMs: number | null;
  keyCount: number | null;
  bpm: number | null;
  analysis: ManiaPatternDetailView;
}) {
  const { dict } = useAppDict();
  const detail = dict?.practice.detail;
  const charts = useChartStyles();

  if (analysis.error || analysis.samples.length === 0) {
    return (
      <div className="space-y-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
            {detail?.sevenkTitle}
          </h2>
          <p className="mt-1 text-sm text-muted">{detail?.sevenkSubtitle}</p>
        </div>
        <p className="text-sm text-faint">
          {analysis.error ?? detail?.sevenkNoSamples}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.24em] text-accent/80">
            {detail?.sevenkTitle}
          </div>
          <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink">
            {formatPatternLabel(
              analysis.dominantPattern ?? "mixed",
              detail?.patterns,
            )}
            {analysis.secondaryPattern
              ? ` · ${formatPatternLabel(
                  analysis.secondaryPattern,
                  detail?.patterns,
                )}`
              : ""}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            {detail?.sevenkDescription}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
          <HeroMetric
            label={detail?.avgNps}
            value={analysis.averageNps.toFixed(1)}
          />
          <HeroMetric
            label={detail?.peakNps}
            value={analysis.peakNps.toFixed(1)}
          />
          <HeroMetric
            label={detail?.peakChord}
            value={`${analysis.peakChordSize}K`}
          />
          <HeroMetric
            label={detail?.confidence}
            value={
              analysis.confidence != null
                ? `${Math.round(analysis.confidence * 100)}%`
                : "—"
            }
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MiniPanelStat
          label={detail?.bpm}
          value={bpm != null ? bpm.toFixed(0) : "—"}
        />
        <MiniPanelStat
          label={detail?.keys}
          value={keyCount != null ? `${keyCount}K` : "—"}
        />
        <MiniPanelStat
          label={detail?.length}
          value={formatPanelDuration(analysis.durationMs || beatmapLengthMs)}
        />
        <MiniPanelStat
          label={detail?.notes}
          value={analysis.noteCount.toLocaleString()}
        />
        <MiniPanelStat
          label={detail?.lnNotes}
          value={analysis.holdCount.toLocaleString()}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_20rem]">
        <DensityOverTimeChart samples={analysis.samples} />
        <aside className="space-y-4">
          <PatternWeightsPanel
            composition={analysis.composition}
            keyCount={keyCount}
            accentColor={charts.chartAlt}
          />
          <HotspotsList hotspots={analysis.hotspots} />
        </aside>
      </div>
    </div>
  );
}

function HeroMetric({ label, value }: { label?: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/10 px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-faint">
        {label}
      </div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-ink">
        {value}
      </div>
    </div>
  );
}

function MiniPanelStat({ label, value }: { label?: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/10 px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-faint">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-ink">
        {value}
      </div>
    </div>
  );
}
