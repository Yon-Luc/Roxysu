import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BeatmapCover } from "../../components/BeatmapCover";
import { BeatmapPreviewButton } from "../../components/BeatmapPreviewModal";
import { CopyBeatmapSearchButton } from "../../components/CopyBeatmapSearchButton";
import {
  HeroSkeleton,
  ListSkeleton,
  PanelSkeleton,
  SkeletonBlock,
  StatGridSkeleton,
} from "../../components/LoadingSkeleton";
import { ModBadges } from "../../components/ModBadges";
import { ScoreReplayButton } from "../../components/ScoreReplayModal";
import { fetchBeatmap } from "../../lib/api";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
} from "../../lib/format";
import {
  osuClientBeatmapUrl,
  osuWebBeatmapUrl,
} from "../../lib/osuUrls";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { useChartStyles } from "../../lib/chartStyles";
import roxyIcon from "../../roxy.png";

export function PracticeProfilePage({ beatmapId }: { beatmapId: string }) {
  const ratingMode = useRatingDisplayMode();
  const charts = useChartStyles();
  const { data, isLoading, error } = useQuery({
    queryKey: ["beatmap", beatmapId],
    queryFn: () => fetchBeatmap(beatmapId),
    enabled: Boolean(beatmapId),
  });
  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <Link to="/practice" className="rx-back">
            ← Practice
          </Link>
          <HeroSkeleton />
        </div>
        <StatGridSkeleton />
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={3} />
        </section>
        <PanelSkeleton lines={1} className="min-h-[20rem]" />
        <section>
          <SkeletonBlock className="mb-3 h-8 w-40 rounded-lg" />
          <ListSkeleton count={6} showThumbnail={false} />
        </section>
      </div>
    );
  }

  if (error || !data || !("beatmap" in data) || !data.beatmap) {
    return (
      <div className="space-y-3">
        <Link to="/practice" className="rx-back">
          ← Practice
        </Link>
        <p className="text-rose-300">
          {error?.message ?? "Beatmap not found"}
        </p>
      </div>
    );
  }

  const beatmap = data.beatmap;
  const stats = data.stats!;
  const recentScores = data.recentScores ?? [];
  const mastery = data.mastery;
  const sunnyDan =
    data && "sunnyDan" in data
      ? (data as { sunnyDan?: {
          estDiff: string | null;
          sunnyStar: number | null;
          columnCount: number | null;
          lnRatio: number | null;
          error: string | null;
        } | null }).sunnyDan
      : null;
  const patternAnalysis =
    data && "patternAnalysis" in data
      ? (data as { patternAnalysis?: {
          algorithm: string;
          dominantPattern: string | null;
          secondaryPattern: string | null;
          confidence: number | null;
          jackDensity: number | null;
          chordDensity: number | null;
          streamDensity: number | null;
          bracketDensity: number | null;
          chordjackScore: number | null;
          jumpstreamScore: number | null;
          chordstreamScore: number | null;
          error: string | null;
        } | null }).patternAnalysis
      : null;
  const timingAnalysis =
    data && "timingAnalysis" in data
      ? (data as { timingAnalysis?: ChartTimingView | null }).timingAnalysis
      : null;
  const sevenKAnalysis =
    data && "sevenKAnalysis" in data
      ? (data as { sevenKAnalysis?: SevenKAnalysisView | null }).sevenKAnalysis
      : null;
  const sessions = data.sessions ?? [];
  const clientUrl = osuClientBeatmapUrl(beatmap.onlineId);
  const webUrl = osuWebBeatmapUrl(beatmap.onlineId, beatmap.setOnlineId);

  return (
    <div className="space-y-8">
      <div>
        <Link to="/practice" className="rx-back">
          ← Practice
        </Link>
        <div className="relative mt-4 overflow-hidden rounded-xl">
          <BeatmapCover
            backgroundFileHash={beatmap.backgroundFileHash}
            setOnlineId={beatmap.setOnlineId}
            size="cover"
            className="aspect-[21/9] w-full max-h-64 sm:max-h-72"
            alt=""
          />
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <p className="text-sm font-medium text-subtle">
              {beatmap.artist}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <img
                src={roxyIcon}
                alt=""
                className="size-14 shrink-0 rounded-full object-cover sm:size-16"
              />
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                {beatmap.title}
              </h1>
            </div>
            <p className="mt-2 text-sm text-muted">
              [{beatmap.difficultyName}] ·{" "}
              {formatPrimaryRating({
                mode: ratingMode,
                starRating: beatmap.starRating,
                sunnyEstDiff: sunnyDan?.estDiff,
                sunnyStar: sunnyDan?.sunnyStar,
              })}{" "}
              · {beatmap.bpm.toFixed(0)} BPM
              {beatmap.mapperUsername
                ? ` · mapped by ${beatmap.mapperUsername}`
                : ""}
              {ratingMode === "osu" && sunnyDan?.estDiff
                ? ` · Sunny ${sunnyDan.estDiff}`
                : ""}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <BeatmapPreviewButton beatmapId={beatmap.id} />
              {clientUrl && (
                <a href={clientUrl} className="rx-btn-primary">
                  Open in osu!
                </a>
              )}
              <CopyBeatmapSearchButton
                title={beatmap.title}
                difficultyName={beatmap.difficultyName}
              />
              <a
                href={`/api/beatmaps/${beatmap.id}/export`}
                className="rx-btn"
                download
              >
                Export map
              </a>
              <a
                href={`/api/beatmaps/${beatmap.id}/export-set`}
                className="rx-btn"
                download
              >
                Export set
              </a>
              {webUrl && (
                <a
                  href={webUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rx-btn"
                >
                  View on website
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        <MiniStat label="Plays" value={String(stats.playCount)} />
        <MiniStat label="Best acc" value={formatAccuracy(stats.bestAccuracy)} />
        <MiniStat label="Best PP" value={formatPp(stats.bestPp)} />
        <MiniStat
          label="Last played"
          value={formatRelativeTime(stats.lastPlayedAt)}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rx-panel px-5 py-5">
          <h3 className="text-sm font-bold text-ink">Mastery</h3>
          {mastery ? (
            <div className="mt-3 space-y-1">
              <div className="font-display text-4xl font-extrabold tabular-nums text-accent">
                {mastery.level.toFixed(1)}
              </div>
              <p className="text-xs text-muted">
                Formula: {mastery.formulaId} · {mastery.playCount} plays
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-faint">No mastery yet.</p>
          )}
        </div>
        {beatmap.rulesetShortName === "mania" && (
          <div className="rx-panel px-5 py-5">
            <h3 className="text-sm font-bold text-ink">Sunny dan</h3>
            {sunnyDan?.estDiff ? (
              <div className="mt-3 space-y-1">
                <div className="font-display text-2xl font-extrabold text-accent">
                  {sunnyDan.estDiff}
                </div>
                <p className="text-xs text-muted">
                  {sunnyDan.sunnyStar != null
                    ? `${sunnyDan.sunnyStar.toFixed(2)}★ rework`
                    : "rework"}
                  {sunnyDan.columnCount != null
                    ? ` · ${sunnyDan.columnCount}K`
                    : ""}
                  {sunnyDan.lnRatio != null
                    ? ` · LN ${(sunnyDan.lnRatio * 100).toFixed(0)}%`
                    : ""}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-faint">
                {sunnyDan?.error ?? "Not available"}
              </p>
            )}
          </div>
        )}
        {patternAnalysis != null && (
          <div className="rx-panel px-5 py-5">
            <h3 className="text-sm font-bold text-ink">Pattern</h3>
            {patternAnalysis.dominantPattern ? (
              <div className="mt-3 space-y-1">
                <div className="font-display text-2xl font-extrabold text-accent">
                  {formatPatternLabel(patternAnalysis.dominantPattern)}
                </div>
                <p className="text-xs text-muted">
                  {patternAnalysis.secondaryPattern
                    ? `+ ${formatPatternLabel(patternAnalysis.secondaryPattern)}`
                    : null}
                  {patternAnalysis.confidence != null
                    ? `${patternAnalysis.secondaryPattern ? " · " : ""}${Math.round(patternAnalysis.confidence * 100)}% confidence`
                    : null}
                </p>
                <PatternDensityHints pattern={patternAnalysis} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-faint">
                {patternAnalysis.error ?? "Not available"}
              </p>
            )}
          </div>
        )}
        <div className="rx-panel px-5 py-5">
          <h3 className="text-sm font-bold text-ink">Sessions</h3>
          {sessions.length === 0 ? (
            <p className="mt-3 text-sm text-faint">No sessions linked.</p>
          ) : (
            <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/sessions/$sessionId"
                    params={{
                      sessionId:
                        s.endedAt == null ? "current" : String(s.id),
                    }}
                    className="rx-row justify-between !px-2 !py-1.5 text-sm"
                  >
                    <span className="text-subtle">
                      {formatRelativeTime(s.startedAt)}
                    </span>
                    <span className="tabular-nums text-muted">
                      {s.scoreCount} plays
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {beatmap.rulesetShortName === "mania" && sevenKAnalysis != null ? (
        <section className="rx-panel p-5 sm:p-6">
          <SevenKDensityPanel
            beatmapLengthMs={beatmap.length ?? null}
            keyCount={
              beatmap.circleSize != null ? Math.round(beatmap.circleSize) : null
            }
            bpm={beatmap.bpm ?? null}
            analysis={sevenKAnalysis}
            charts={charts}
          />
        </section>
      ) : null}

      {beatmap.rulesetShortName === "mania" && timingAnalysis != null ? (
        <section className="rx-panel p-5">
          <h2 className="text-sm font-bold text-ink">Timing analysis</h2>
          <TimingAnalysisPanel timing={timingAnalysis} />
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 font-display text-2xl font-bold tracking-tight text-ink">
          Score timeline
        </h2>
        {recentScores.length === 0 ? (
          <p className="text-sm text-muted">No scores on this map yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {recentScores.map((score) => (
              <li key={score.id} className="rx-row justify-between gap-3">
                <div className="flex min-w-0 items-center gap-1.5 text-sm text-subtle">
                  <span>{formatRelativeTime(score.playedAt)}</span>
                  <ModBadges mods={score.mods} />
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm font-semibold tabular-nums text-ink">
                  <ScoreReplayButton
                    scoreId={score.id}
                    enabled={
                      score.hasReplay && score.rulesetShortName === "mania"
                    }
                    className="rx-btn !px-2.5 !py-1 text-xs font-semibold"
                  />
                  <span>{formatAccuracy(score.accuracy)}</span>
                  <span className="text-subtle">{formatPp(score.pp)}</span>
                  <span className="text-muted">{score.maxCombo}x</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rx-stat">
      <div className="rx-label">{label}</div>
      <div className="mt-1.5 text-lg font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}

const PATTERN_LABELS: Record<string, string> = {
  jack: "Jack",
  jumpstream: "Jumpstream",
  chordjack: "Chordjack",
  bracket: "Bracket",
  chordstream: "Chordstream",
  stream: "Stream",
  delay: "Delay",
  mixed: "Mixed",
};

function formatPatternLabel(pattern: string): string {
  return PATTERN_LABELS[pattern] ?? pattern;
}

function PatternDensityHints({
  pattern,
}: {
  pattern: {
    dominantPattern: string | null;
    jackDensity: number | null;
    chordDensity: number | null;
    streamDensity: number | null;
    bracketDensity: number | null;
  };
}) {
  const hints: string[] = [];
  const dominant = pattern.dominantPattern;

  const add = (label: string, value: number | null, key: string) => {
    if (value == null || value < 0.08 || key === dominant) return;
    hints.push(`${label} ${Math.round(value * 100)}%`);
  };

  add("jack", pattern.jackDensity, "jack");
  add("chord", pattern.chordDensity, "chordjack");
  add("delay", pattern.streamDensity, "delay");
  add("bracket", pattern.bracketDensity, "bracket");

  if (hints.length === 0) return null;

  return <p className="text-xs text-faint">{hints.join(" · ")}</p>;
}

type TimingIssueView = {
  kind: string;
  severity: string;
  startMs: number;
  endMs?: number;
  message: string;
};

type ChartTimingView = {
  algorithm: string;
  metrics: {
    bpm: number;
    dominantSnap: number;
    snapCoverage: number;
    offSnapRatio: number;
    peakNotesPerBeat: number;
    timingPointCount: number;
  };
  issues: TimingIssueView[];
  issueCounts: Record<string, number>;
  error: string | null;
};

type SevenKDensitySampleView = {
  startMs: number;
  endMs: number;
  midpointMs: number;
  noteCount: number;
  notesPerSecond: number;
  peakChordSize: number;
  dominantPattern: string | null;
  secondaryPattern: string | null;
  composition: Record<string, number>;
};

type SevenKHotspotView = {
  startMs: number;
  endMs: number;
  noteCount: number;
  notesPerSecond: number;
  dominantPattern: string | null;
  secondaryPattern: string | null;
  dominantCoverage: number;
};

type SevenKAnalysisView = {
  algorithm: string;
  columnCount: number | null;
  noteCount: number;
  holdCount: number;
  durationMs: number;
  averageNps: number;
  peakNps: number;
  peakChordSize: number;
  dominantPattern: string | null;
  secondaryPattern: string | null;
  confidence: number | null;
  composition: Record<string, number>;
  samples: SevenKDensitySampleView[];
  hotspots: SevenKHotspotView[];
  error: string | null;
};

const ISSUE_KIND_LABELS: Record<string, string> = {
  off_snap: "Off snap",
  inconsistent_snap: "Ambiguous snap",
  bpm_change: "BPM change",
  high_density: "High density",
  ln_off_snap: "LN off snap",
  overlap: "Overlap",
  missing_timing_points: "Missing timing",
};

function formatIssueKind(kind: string): string {
  return ISSUE_KIND_LABELS[kind] ?? kind;
}

function severityClass(severity: string): string {
  switch (severity) {
    case "error":
      return "text-rose-300";
    case "warn":
      return "text-amber-200/90";
    default:
      return "text-muted";
  }
}

function TimingAnalysisPanel({ timing }: { timing: ChartTimingView }) {
  if (timing.error) {
    return <p className="mt-3 text-sm text-faint">{timing.error}</p>;
  }

  const m = timing.metrics;
  const totalIssues = Object.values(timing.issueCounts).reduce(
    (sum, n) => sum + (n ?? 0),
    0,
  );

  return (
    <div className="mt-4 space-y-5">
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm tabular-nums text-subtle">
        <span>
          Chart BPM{" "}
          <span className="font-semibold text-ink">{m.bpm.toFixed(1)}</span>
        </span>
        <span>
          Snap{" "}
          <span className="font-semibold text-ink">1/{m.dominantSnap}</span>
        </span>
        <span>
          Coverage{" "}
          <span className="font-semibold text-ink">
            {Math.round(m.snapCoverage * 100)}%
          </span>
        </span>
        <span>
          Peak density{" "}
          <span className="font-semibold text-ink">{m.peakNotesPerBeat}</span>
          /beat
        </span>
        {totalIssues > 0 ? (
          <span>
            Issues{" "}
            <span className="font-semibold text-ink">{totalIssues}</span>
          </span>
        ) : null}
      </div>

      {timing.issues.length > 0 ? (
        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
          {timing.issues.map((issue, idx) => (
            <li
              key={`${issue.kind}-${issue.startMs}-${idx}`}
              className={`flex gap-2 ${severityClass(issue.severity)}`}
            >
              <span className="shrink-0 font-mono text-xs text-faint">
                {formatTimeMs(issue.startMs)}
              </span>
              <span className="shrink-0 text-xs uppercase tracking-wide opacity-80">
                {formatIssueKind(issue.kind)}
              </span>
              <span className="min-w-0 text-subtle">{issue.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No timing issues detected on snap grid.</p>
      )}
    </div>
  );
}

function SevenKDensityPanel({
  beatmapLengthMs,
  keyCount,
  bpm,
  analysis,
  charts,
}: {
  beatmapLengthMs: number | null;
  keyCount: number | null;
  bpm: number | null;
  analysis: SevenKAnalysisView;
  charts: ReturnType<typeof useChartStyles>;
}) {
  const chartData = analysis.samples.map((sample) => ({
    ...sample,
    timeLabel: formatTimeMs(sample.startMs),
    displayPattern: formatPatternLabel(sample.dominantPattern ?? "mixed"),
    displaySecondary: sample.secondaryPattern
      ? formatPatternLabel(sample.secondaryPattern)
      : null,
  }));
  const metricRows = [
    { label: "Jack", value: analysis.composition.jack ?? 0 },
    { label: "Chordjack", value: analysis.composition.chordjack ?? 0 },
    { label: "Delay", value: analysis.composition.delay ?? 0 },
    { label: "Chordstream", value: analysis.composition.chordstream ?? 0 },
    { label: "Bracket", value: analysis.composition.bracket ?? 0 },
  ];

  if (analysis.error || chartData.length === 0) {
    return (
      <div className="space-y-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
            7K density profile
          </h2>
          <p className="mt-1 text-sm text-muted">
            Chart-derived density and pattern hotspots for 7K practice.
          </p>
        </div>
        <p className="text-sm text-faint">
          {analysis.error ?? "No density samples available for this chart yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.24em] text-accent/80">
            7K density profile
          </div>
          <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink">
            {formatPatternLabel(analysis.dominantPattern ?? "mixed")}
            {analysis.secondaryPattern
              ? ` · ${formatPatternLabel(analysis.secondaryPattern)}`
              : ""}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            A chart-first read on density, hotspots, and pattern makeup so you can
            see where this 7K map actually spikes.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
          <HeroMetric label="Avg NPS" value={analysis.averageNps.toFixed(1)} />
          <HeroMetric label="Peak NPS" value={analysis.peakNps.toFixed(1)} />
          <HeroMetric label="Peak chord" value={`${analysis.peakChordSize}K`} />
          <HeroMetric
            label="Confidence"
            value={
              analysis.confidence != null
                ? `${Math.round(analysis.confidence * 100)}%`
                : "—"
            }
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MiniPanelStat label="BPM" value={bpm != null ? bpm.toFixed(0) : "—"} />
        <MiniPanelStat label="Keys" value={keyCount != null ? `${keyCount}K` : "—"} />
        <MiniPanelStat label="Length" value={formatPanelDuration(analysis.durationMs || beatmapLengthMs)} />
        <MiniPanelStat label="Notes" value={analysis.noteCount.toLocaleString()} />
        <MiniPanelStat label="LN notes" value={analysis.holdCount.toLocaleString()} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.75fr)_20rem]">
        <div className="rounded-xl border border-white/8 bg-black/10 p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-ink">Density over time</h3>
              <p className="mt-0.5 text-xs text-muted">
                Per-second note density with local pattern hints.
              </p>
            </div>
            <div className="text-right text-xs text-faint">
              {analysis.samples.length.toLocaleString()} samples
            </div>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="sevenk-density-fill" x1="0" y1="0" x2="0" y2="1">
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
                minTickGap={20}
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
                  const sample = payload?.[0]?.payload as SevenKDensitySampleView | undefined;
                  return sample
                    ? `${formatTimeMs(sample.startMs)} - ${formatTimeMs(sample.endMs)}`
                    : "";
                }}
                formatter={(value, name, item) => {
                  if (name === "notesPerSecond") {
                    return [`${Number(value).toFixed(1)} NPS`, "Density"];
                  }
                  if (name === "peakChordSize") {
                    return [`${value}K`, "Peak chord"];
                  }
                  const payload = item.payload as typeof chartData[number];
                  if (name === "displayPattern") {
                    return [
                      payload.displaySecondary
                        ? `${payload.displayPattern} + ${payload.displaySecondary}`
                        : payload.displayPattern,
                      "Pattern",
                    ];
                  }
                  return [String(value), String(name)];
                }}
              />
              <Area
                type="monotone"
                dataKey="notesPerSecond"
                stroke={charts.chart}
                fill="url(#sevenk-density-fill)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-white/8 bg-black/10 p-4">
            <h3 className="text-sm font-bold text-ink">Pattern weights</h3>
            <div className="mt-4 space-y-3">
              {metricRows.map((row) => (
                <PatternMetricRow
                  key={row.label}
                  label={row.label}
                  value={row.value}
                  accentColor={charts.chartAlt}
                />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/8 bg-black/10 p-4">
            <h3 className="text-sm font-bold text-ink">Hotspots</h3>
            {analysis.hotspots.length === 0 ? (
              <p className="mt-3 text-sm text-faint">No dense sections detected.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {analysis.hotspots.map((hotspot) => (
                  <li
                    key={`${hotspot.startMs}-${hotspot.endMs}`}
                    className="rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-ink">
                        {formatTimeMs(hotspot.startMs)} - {formatTimeMs(hotspot.endMs)}
                      </span>
                      <span className="text-xs font-bold tabular-nums text-accent">
                        {hotspot.notesPerSecond.toFixed(1)} NPS
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {formatPatternLabel(hotspot.dominantPattern ?? "mixed")}
                      {hotspot.secondaryPattern
                        ? ` + ${formatPatternLabel(hotspot.secondaryPattern)}`
                        : ""}
                      {hotspot.dominantCoverage > 0
                        ? ` · ${Math.round(hotspot.dominantCoverage * 100)}% coverage`
                        : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
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

function MiniPanelStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/10 px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-faint">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function PatternMetricRow({
  label,
  value,
  accentColor,
}: {
  label: string;
  value: number;
  accentColor: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-subtle">{label}</span>
        <span className="tabular-nums text-muted">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: accentColor }}
        />
      </div>
    </div>
  );
}

function formatTimeMs(ms: number): string {
  const sec = Math.max(0, ms / 1000);
  const mins = Math.floor(sec / 60);
  const rem = sec - mins * 60;
  return `${mins}:${rem.toFixed(1).padStart(4, "0")}`;
}

function formatPanelDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
