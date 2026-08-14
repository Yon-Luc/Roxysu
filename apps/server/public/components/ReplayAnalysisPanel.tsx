import type { ScoreReplay } from "../lib/api";
import {
  analyzeMissPatterns,
  computeColumnHeat,
  computeTimingStats,
  FIDELITY_ACC_DELTA,
  PATTERN_TAG_LABEL,
  summarizePatternTags,
  type MissPatternInfo,
  type PatternTag,
  type TimingStats,
} from "../lib/replayPatterns";
import { formatAccuracy, formatClockFrac } from "../lib/format";
import { JUDGMENT_COLORS } from "./ManiaNotefield";

export type ReplayAnalysis = ReturnType<typeof buildReplayAnalysis>;

export function buildReplayAnalysis(data: ScoreReplay | undefined) {
  if (!data) {
    return {
      misses: [] as MissPatternInfo[],
      tagCounts: null as ReturnType<typeof summarizePatternTags> | null,
      timing: null as TimingStats | null,
      columnHeat: [] as ReturnType<typeof computeColumnHeat>,
      heatIntensities: [] as number[],
      fidelityWarn: false,
      accDelta: 0,
    };
  }

  const judgments = data.judgments.map((j) => ({
    noteIndex: j.noteIndex,
    tMs: j.tMs,
    result: j.result,
    errorMs: j.errorMs ?? null,
    isTail: j.isTail,
  }));
  const notes = data.beatmap.notes;
  const misses = analyzeMissPatterns(notes, judgments);
  const tagCounts = summarizePatternTags(misses);
  const timing = computeTimingStats(judgments);
  const columnHeat = computeColumnHeat(
    notes,
    judgments,
    data.beatmap.columnCount,
  );
  const heatIntensities = columnHeat.map((c) => c.intensity);
  const accDelta = Math.abs(data.simulated.accuracy - data.score.accuracy);
  const fidelityWarn = accDelta >= FIDELITY_ACC_DELTA;

  return {
    misses,
    tagCounts,
    timing,
    columnHeat,
    heatIntensities,
    fidelityWarn,
    accDelta,
  };
}

type ReplayAnalysisPanelProps = {
  data: ScoreReplay;
  analysis: ReplayAnalysis;
  onJumpToMiss: (tMs: number) => void;
  activeMissTMs: number | null;
};

export function ReplayAnalysisPanel({
  data,
  analysis,
  onJumpToMiss,
  activeMissTMs,
}: ReplayAnalysisPanelProps) {
  const {
    misses,
    tagCounts,
    timing,
    columnHeat,
    fidelityWarn,
    accDelta,
  } = analysis;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col gap-3 overflow-y-auto border-t border-white/10 bg-black/55 p-3 backdrop-blur sm:border-l sm:border-t-0 sm:p-4">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-on-media-muted">
          Analysis
        </h3>
        <p className="mt-0.5 text-xs text-on-media-muted">
          Approximate judge — practice signal only.
        </p>
      </div>

      {fidelityWarn ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100/90">
          Simulated accuracy differs from stored by{" "}
          {(accDelta * 100).toFixed(1)} pts (
          {formatAccuracy(data.simulated.accuracy)} vs{" "}
          {formatAccuracy(data.score.accuracy)}). Miss locations may be
          imperfect.
        </div>
      ) : null}

      {timing && timing.count > 0 ? (
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-on-media-muted">
            Timing
          </h4>
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-on-media-muted">
            <span>
              μ {timing.mean >= 0 ? "+" : ""}
              {timing.mean.toFixed(1)}ms
            </span>
            <span>σ {timing.stddev.toFixed(1)}ms</span>
            <span>early {timing.earlyPct.toFixed(0)}%</span>
            <span>late {timing.latePct.toFixed(0)}%</span>
          </div>
          <TimingHistogram timing={timing} />
        </section>
      ) : (
        <p className="text-xs text-on-media-muted">No timing samples (all miss / empty).</p>
      )}

      {columnHeat.length > 0 ? (
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-on-media-muted">
            Columns
          </h4>
          <div className="flex gap-1">
            {columnHeat.map((c) => (
              <div
                key={c.column}
                className="min-w-0 flex-1 text-center"
                title={`Col ${c.column + 1}: ${c.missCount} miss · ${
                  c.meanAbsError != null
                    ? `±${c.meanAbsError.toFixed(1)}ms`
                    : "—"
                }`}
              >
                <div
                  className="mx-auto mb-1 h-10 w-full max-w-[2rem] rounded-sm"
                  style={{
                    background:
                      c.intensity > 0
                        ? `rgba(248, 113, 113, ${0.2 + c.intensity * 0.7})`
                        : "rgba(255, 255, 255, 0.08)",
                  }}
                />
                <div className="text-[10px] tabular-nums text-on-media-muted">
                  {c.column + 1}
                </div>
                <div className="text-[10px] tabular-nums text-rose-300/90">
                  {c.missCount}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tagCounts ? (
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-on-media-muted">
            Miss patterns
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PATTERN_TAG_LABEL) as PatternTag[]).map((tag) => {
              const n = tagCounts[tag];
              if (n <= 0) return null;
              return (
                <span
                  key={tag}
                  className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-on-media"
                >
                  {PATTERN_TAG_LABEL[tag]} {n}
                </span>
              );
            })}
            {misses.length === 0 ? (
              <span className="text-xs text-on-media-muted">No misses</span>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="min-h-0 flex-1">
        <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-on-media-muted">
          Misses ({misses.length})
        </h4>
        {misses.length === 0 ? (
          <p className="text-xs text-on-media-muted">Clean — no simulated misses.</p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto sm:max-h-none">
            {misses.map((m) => {
              const active =
                activeMissTMs != null && Math.abs(activeMissTMs - m.tMs) < 1;
              return (
                <li key={`${m.noteIndex}-${m.isTail ? "t" : "h"}-${m.tMs}`}>
                  <button
                    type="button"
                    onClick={() => onJumpToMiss(m.tMs)}
                    className={
                      active
                        ? "flex w-full flex-col gap-0.5 rounded-lg border border-accent/50 bg-accent/15 px-2.5 py-1.5 text-left transition"
                        : "flex w-full flex-col gap-0.5 rounded-lg border border-transparent bg-white/5 px-2.5 py-1.5 text-left transition hover:bg-white/10"
                    }
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium tabular-nums text-on-media">
                        {formatClockFrac(m.tMs)}
                      </span>
                      <span className="tabular-nums text-on-media-muted">
                        col {m.column + 1}
                        {m.isTail ? " · tail" : ""}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {m.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-black/40 px-1.5 py-px text-[10px] text-on-media-muted"
                        >
                          {PATTERN_TAG_LABEL[tag]}
                        </span>
                      ))}
                      {m.jackGapMs != null && m.tags.includes("jack") ? (
                        <span className="rounded bg-black/40 px-1.5 py-px text-[10px] tabular-nums text-on-media-muted">
                          Δ{m.jackGapMs}ms
                        </span>
                      ) : null}
                      {m.chordSize >= 2 ? (
                        <span className="rounded bg-black/40 px-1.5 py-px text-[10px] tabular-nums text-on-media-muted">
                          ×{m.chordSize}
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}

function TimingHistogram({ timing }: { timing: TimingStats }) {
  const max = Math.max(1, ...timing.bins.map((b) => b.count));
  return (
    <div
      className="flex h-16 items-end gap-px rounded-md bg-black/40 px-1 py-1"
      role="img"
      aria-label="Timing error histogram"
    >
      {timing.bins.map((b) => {
        const h = (b.count / max) * 100;
        const early = b.center < 0;
        return (
          <div
            key={b.center}
            className="min-w-0 flex-1 rounded-sm"
            style={{
              height: `${Math.max(b.count > 0 ? 8 : 2, h)}%`,
              background:
                b.count === 0
                  ? "rgba(255,255,255,0.06)"
                  : early
                    ? "rgba(125, 211, 252, 0.85)"
                    : b.center === 0
                      ? JUDGMENT_COLORS.perfect
                      : "rgba(253, 186, 116, 0.9)",
            }}
            title={`${b.center >= 0 ? "+" : ""}${b.center.toFixed(0)}ms: ${b.count}`}
          />
        );
      })}
    </div>
  );
}

export function MissSeekMarkers({
  misses,
  maxDuration,
  onJump,
}: {
  misses: MissPatternInfo[];
  maxDuration: number;
  onJump: (tMs: number) => void;
}) {
  if (misses.length === 0 || maxDuration <= 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2">
      {misses.map((m) => {
        const pct = Math.min(100, Math.max(0, (m.tMs / maxDuration) * 100));
        return (
          <button
            key={`${m.noteIndex}-${m.isTail ? "t" : "h"}-${m.tMs}`}
            type="button"
            className="pointer-events-auto absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-rose-400/90 hover:bg-rose-300"
            style={{ left: `${pct}%` }}
            title={`Miss ${formatClockFrac(m.tMs)} col ${m.column + 1}`}
            aria-label={`Jump to miss at ${formatClockFrac(m.tMs)}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onJump(m.tMs);
            }}
          />
        );
      })}
    </div>
  );
}
