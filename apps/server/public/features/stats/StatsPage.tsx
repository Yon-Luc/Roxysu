import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageTitle } from "../../components/PageTitle";
import {
  ChartGridSkeleton,
  ListSkeleton,
  PageHeaderSkeleton,
  PanelSkeleton,
  SkeletonBlock,
  StatGridSkeleton,
} from "../../components/LoadingSkeleton";
import {
  fetchSkillBandPlays,
  fetchStats,
  type SkillBandKind,
  type StatsGranularity,
  type StatsRange,
  type StatsSkillAxis,
  type PlayerStats,
} from "../../lib/api";
import {
  formatAccuracy,
  formatChartDay,
  formatPp,
  formatRelativeTime,
  formatStars,
} from "../../lib/format";
import {
  formatSkillRating,
  useRatingDisplayMode,
  type RatingDisplayMode,
  type SkillRatingAxis,
} from "../../lib/ratingDisplay";
import { useChartStyles } from "../../lib/chartStyles";
import { useAppDict, t } from "../../lib/i18n";
import {
  buildStatsGradeQuery,
  openInPractice,
} from "../../lib/practiceSearch";
import type { Dictionary } from "@roxysu/i18n";

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function skillAxisLabel(
  dict: Dictionary["app"] | undefined,
  axis: StatsSkillAxis,
): string {
  switch (axis) {
    case "rc":
      return dict?.stats.axisRice ?? "Rice";
    case "ln":
      return dict?.stats.axisLn ?? "LN";
    case "fln":
      return dict?.stats.axisFln ?? "FLN";
    default:
      return dict?.stats.axisAll ?? "All";
  }
}

function skillRatingAxis(
  axis: StatsSkillAxis,
): SkillRatingAxis {
  if (axis === "rc" || axis === "ln" || axis === "fln") return axis;
  return "overall";
}

function skillBandValue(
  skill: PlayerStats["skill"],
  band: "peak" | "accuracy" | "consistency",
  axis: StatsSkillAxis,
): number {
  const values = {
    peak: {
      all: skill.peakOverall,
      rc: skill.peakRc,
      ln: skill.peakLn,
      fln: skill.peakFln,
    },
    accuracy: {
      all: skill.accuracyOverall,
      rc: skill.accuracyRc,
      ln: skill.accuracyLn,
      fln: skill.accuracyFln,
    },
    consistency: {
      all: skill.consistencyOverall,
      rc: skill.consistencyRc,
      ln: skill.consistencyLn,
      fln: skill.consistencyFln,
    },
  } as const;
  if (axis === "all") return values[band].all;
  return values[band][axis];
}

function skillBandMaps(
  skill: PlayerStats["skill"],
  band: "peak" | "accuracy" | "consistency",
  axis: StatsSkillAxis,
): number {
  const values = {
    peak: {
      all: skill.clearRcMaps + skill.clearLnMaps + skill.clearFlnMaps,
      rc: skill.clearRcMaps,
      ln: skill.clearLnMaps,
      fln: skill.clearFlnMaps,
    },
    accuracy: {
      all: skill.accuracyRcMaps + skill.accuracyLnMaps + skill.accuracyFlnMaps,
      rc: skill.accuracyRcMaps,
      ln: skill.accuracyLnMaps,
      fln: skill.accuracyFlnMaps,
    },
    consistency: {
      all:
        skill.consistencyRcMaps +
        skill.consistencyLnMaps +
        skill.consistencyFlnMaps,
      rc: skill.consistencyRcMaps,
      ln: skill.consistencyLnMaps,
      fln: skill.consistencyFlnMaps,
    },
  } as const;
  return values[band][axis];
}

function historyBandValue(
  point: NonNullable<PlayerStats["skillHistory"]>[number],
  band: "push" | "accuracy" | "consistency",
  axis: StatsSkillAxis,
): number {
  if (axis === "all") return point[band];
  const key = `${band}${axis.charAt(0).toUpperCase()}${axis.slice(1)}` as
    | "pushRc"
    | "pushLn"
    | "pushFln"
    | "accuracyRc"
    | "accuracyLn"
    | "accuracyFln"
    | "consistencyRc"
    | "consistencyLn"
    | "consistencyFln";
  const axisValue = point[key];
  return axisValue > 0 ? axisValue : point[band];
}

function skillTooltipFormatter(
  mode: RatingDisplayMode,
  value: unknown,
  name: unknown,
  axis: StatsSkillAxis,
): [string, string] {
  const label = String(name ?? "");
  const n = typeof value === "number" ? value : Number(value);
  return [
    formatSkillRating({
      mode,
      sunnyStar: n,
      axis: skillRatingAxis(axis),
    }),
    label,
  ];
}

export function StatsPage({
  granularity,
  range,
  skillTopPlays,
  skillAxis,
  keyCount,
  onGranularityChange,
  onRangeChange,
  onSkillTopPlaysChange,
  onSkillAxisChange,
  onKeyCountChange,
}: {
  granularity: StatsGranularity;
  range: StatsRange;
  skillTopPlays: number;
  skillAxis: StatsSkillAxis;
  keyCount: number;
  onGranularityChange: (g: StatsGranularity) => void;
  onRangeChange: (r: StatsRange) => void;
  onSkillTopPlaysChange: (n: number) => void;
  onSkillAxisChange: (a: StatsSkillAxis) => void;
  onKeyCountChange: (n: number) => void;
}) {
  const ratingMode = useRatingDisplayMode();
  const charts = useChartStyles();
  const navigate = useNavigate();
  const { dict } = useAppDict();
  const [customTopPlays, setCustomTopPlays] = useState(
    String(skillTopPlays),
  );
  const presetTopPlays = [10, 20, 30, 50] as const;
  type TopPlaysTab = (typeof presetTopPlays)[number] | "custom";
  const isPreset = (presetTopPlays as readonly number[]).includes(skillTopPlays);
  const [topPlaysTab, setTopPlaysTab] = useState<TopPlaysTab>(() =>
    isPreset ? (skillTopPlays as TopPlaysTab) : "custom",
  );
  const [expandedBand, setExpandedBand] = useState<SkillBandKind | null>(null);

  useEffect(() => {
    setCustomTopPlays(String(skillTopPlays));
    if ((presetTopPlays as readonly number[]).includes(skillTopPlays)) {
      setTopPlaysTab(skillTopPlays as TopPlaysTab);
    }
  }, [skillTopPlays]);

  useEffect(() => {
    setExpandedBand(null);
  }, [skillAxis, skillTopPlays, keyCount]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["stats", granularity, range, skillTopPlays, keyCount],
    queryFn: () =>
      fetchStats({ granularity, range, skillTopPlays, keyCount }),
  });

  if (isLoading) {
    return (
      <div className="space-y-10">
        <div className="space-y-4">
          <PageHeaderSkeleton
            actions={
              <>
                <SkeletonBlock className="h-9 w-56 rounded-md" />
                <SkeletonBlock className="h-9 w-28 rounded-md" />
                <SkeletonBlock className="h-9 w-36 rounded-md" />
              </>
            }
          />
          <SkeletonBlock className="h-9 w-64 rounded-md" />
        </div>
        <StatGridSkeleton />
        <section>
          <div className="mb-4 h-8 w-40 animate-pulse rounded-lg bg-white/6" />
          <div className="grid gap-3 sm:grid-cols-3">
            <PanelSkeleton lines={3} />
            <PanelSkeleton lines={3} />
            <PanelSkeleton lines={3} />
          </div>
        </section>
        <PanelSkeleton lines={1} className="min-h-[22rem]" />
        <section>
          <div className="mb-4 h-8 w-36 animate-pulse rounded-lg bg-white/6" />
          <ChartGridSkeleton />
        </section>
        <section>
          <div className="mb-4 h-8 w-40 animate-pulse rounded-lg bg-white/6" />
          <StatGridSkeleton count={3} />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <PanelSkeleton lines={1} className="min-h-64" />
            <PanelSkeleton lines={1} className="min-h-64" />
            <PanelSkeleton lines={1} className="min-h-64" />
            <PanelSkeleton lines={1} className="min-h-64" />
          </div>
        </section>
        <section>
          <div className="mb-4 h-8 w-32 animate-pulse rounded-lg bg-white/6" />
          <ListSkeleton count={5} showThumbnail={false} />
        </section>
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-rose-300">
        {t(dict?.stats.failedToLoadStats, {
          error: error?.message ?? "unknown error",
        })}
      </p>
    );
  }

  const skill = data.skill;
  const history = data.skillHistory ?? [];
  const weekly = data.weeklyActivity ?? [];
  const ppTrend = data.ppTrend ?? [];
  const accTrend = data.accuracyTrend ?? [];
  const ranks = data.rankDistribution ?? [];
  const mix = data.skillsetMix;
  const byHour = data.playByHour ?? [];
  const byDow = data.playByDayOfWeek ?? [];
  const mappers = data.topMappers ?? [];
  const sessions = data.sessionStats;
  const summary = data.summary;

  const skillsetBars = [
    {
      axis: dict?.stats.axisRice ?? "Rice",
      plays: mix?.rc ?? 0,
      pct: mix?.rcPct ?? 0,
    },
    {
      axis: dict?.stats.axisLn ?? "LN",
      plays: mix?.ln ?? 0,
      pct: mix?.lnPct ?? 0,
    },
    {
      axis: dict?.stats.axisFln ?? "FLN",
      plays: mix?.fln ?? 0,
      pct: mix?.flnPct ?? 0,
    },
  ];

  const chartHistory = history.map((point) => ({
    at: point.at,
    push: historyBandValue(point, "push", skillAxis),
    accuracy: historyBandValue(point, "accuracy", skillAxis),
    consistency: historyBandValue(point, "consistency", skillAxis),
  }));

  const axisFilterActive = skillAxis !== "all";
  const notEnoughData = dict?.stats.notEnoughData ?? "Not enough data yet.";

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <PageTitle>{dict?.nav.stats ?? "Stats"}</PageTitle>
            <p className="rx-subtitle">
              {t(dict?.stats.subtitle, { keyCount, topPlays: skillTopPlays })}
              {axisFilterActive
                ? ` · ${t(dict?.stats.axisOnly, {
                    axis: skillAxisLabel(dict, skillAxis),
                  })}`
                : ""}
              .
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            value={String(topPlaysTab)}
            options={[
              { id: "10", label: dict?.stats.top10 ?? "Top 10" },
              { id: "20", label: dict?.stats.top20 ?? "Top 20" },
              { id: "30", label: dict?.stats.top30 ?? "Top 30" },
              { id: "50", label: dict?.stats.top50 ?? "Top 50" },
              { id: "custom", label: dict?.stats.custom ?? "Custom" },
            ]}
            onChange={(v) => {
              if (v === "custom") {
                setTopPlaysTab("custom");
                return;
              }
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              setTopPlaysTab(n as TopPlaysTab);
              onSkillTopPlaysChange(n);
              setCustomTopPlays(v);
            }}
          />
          {topPlaysTab === "custom" ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(customTopPlays);
                if (Number.isFinite(n) && n >= 1 && n <= 500) {
                  onSkillTopPlaysChange(Math.round(n));
                }
              }}
            >
              <input
                type="number"
                min={1}
                max={500}
                value={customTopPlays}
                onChange={(e) => setCustomTopPlays(e.target.value)}
                className="rx-input w-20 tabular-nums"
                aria-label={dict?.stats.topPlaysCountAria ?? "Top plays count"}
              />
              <button type="submit" className="rx-btn text-xs">
                {dict?.stats.apply ?? "Apply"}
              </button>
            </form>
          ) : null}
          <ToggleGroup
            value={granularity}
            options={[
              { id: "day", label: dict?.stats.day ?? "Day" },
              { id: "week", label: dict?.stats.week ?? "Week" },
            ]}
            onChange={onGranularityChange}
          />
          <ToggleGroup
            value={String(range)}
            options={[
              { id: "30", label: "30d" },
              { id: "90", label: "90d" },
              { id: "180", label: "180d" },
            ]}
            onChange={(v) => onRangeChange(Number(v) as StatsRange)}
          />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            value={String(keyCount)}
            options={(data.availableKeyCounts ?? [4, 7]).map((k) => ({
              id: String(k),
              label: `${k}K`,
            }))}
            onChange={(v) => onKeyCountChange(Number(v))}
          />
          <ToggleGroup
            value={skillAxis}
            options={[
              { id: "all", label: dict?.stats.axisAll ?? "All" },
              { id: "rc", label: dict?.stats.axisRice ?? "Rice" },
              { id: "ln", label: dict?.stats.axisLn ?? "LN" },
              { id: "fln", label: dict?.stats.axisFln ?? "FLN" },
            ]}
            onChange={onSkillAxisChange}
          />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={dict?.stats.scores ?? "Scores"}
          value={summary.scoreCount.toLocaleString()}
        />
        <Stat
          label={dict?.stats.mapsPlayed ?? "Maps played"}
          value={summary.distinctMapsPlayed.toLocaleString()}
        />
        <Stat
          label={dict?.stats.avgPlaysPerMap ?? "Avg plays / map"}
          value={
            summary.distinctMapsPlayed > 0
              ? (summary.scoreCount / summary.distinctMapsPlayed).toFixed(1)
              : "—"
          }
        />
        <Stat
          label={dict?.stats.sessions ?? "Sessions"}
          value={summary.sessionCount.toLocaleString()}
        />
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">
          {dict?.stats.currentSkill ?? "Current skill"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <SkillCard
            mode={ratingMode}
            axis={skillAxis}
            dict={dict}
            band="push"
            title={dict?.stats.bandPush ?? "Push"}
            hint={dict?.stats.hintPush ?? "90%+ clears"}
            value={skillBandValue(skill, "peak", skillAxis)}
            maps={skillBandMaps(skill, "peak", skillAxis)}
            requiredPlays={skillTopPlays}
            expanded={expandedBand === "push"}
            onToggle={() =>
              setExpandedBand((prev) => (prev === "push" ? null : "push"))
            }
            breakdown={
              axisFilterActive
                ? null
                : {
                    rc: skill.peakRc,
                    ln: skill.peakLn,
                    fln: skill.peakFln,
                    rcMaps: skill.clearRcMaps,
                    lnMaps: skill.clearLnMaps,
                    flnMaps: skill.clearFlnMaps,
                  }
            }
          />
          <SkillCard
            mode={ratingMode}
            axis={skillAxis}
            dict={dict}
            band="accuracy"
            title={dict?.stats.bandAccuracy ?? "Accuracy"}
            hint={dict?.stats.hintAccuracy ?? "99%+ clears"}
            value={skillBandValue(skill, "accuracy", skillAxis)}
            maps={skillBandMaps(skill, "accuracy", skillAxis)}
            requiredPlays={skillTopPlays}
            expanded={expandedBand === "accuracy"}
            onToggle={() =>
              setExpandedBand((prev) =>
                prev === "accuracy" ? null : "accuracy",
              )
            }
            breakdown={
              axisFilterActive
                ? null
                : {
                    rc: skill.accuracyRc,
                    ln: skill.accuracyLn,
                    fln: skill.accuracyFln,
                    rcMaps: skill.accuracyRcMaps,
                    lnMaps: skill.accuracyLnMaps,
                    flnMaps: skill.accuracyFlnMaps,
                  }
            }
          />
          <SkillCard
            mode={ratingMode}
            axis={skillAxis}
            dict={dict}
            band="consistency"
            title={dict?.stats.bandConsistency ?? "Consistency"}
            hint={dict?.stats.hintConsistency ?? "96%+ clears"}
            value={skillBandValue(skill, "consistency", skillAxis)}
            maps={skillBandMaps(skill, "consistency", skillAxis)}
            requiredPlays={skillTopPlays}
            expanded={expandedBand === "consistency"}
            onToggle={() =>
              setExpandedBand((prev) =>
                prev === "consistency" ? null : "consistency",
              )
            }
            breakdown={
              axisFilterActive
                ? null
                : {
                    rc: skill.consistencyRc,
                    ln: skill.consistencyLn,
                    fln: skill.consistencyFln,
                    rcMaps: skill.consistencyRcMaps,
                    lnMaps: skill.consistencyLnMaps,
                    flnMaps: skill.consistencyFlnMaps,
                  }
            }
          />
        </div>
        {expandedBand ? (
          <SkillBandPlaysPanel
            band={expandedBand}
            axis={skillAxis}
            dict={dict}
            topPlays={skillTopPlays}
            keyCount={keyCount}
            ratingMode={ratingMode}
          />
        ) : null}
        {skill.coldStart ? (
          <p className="mt-3 text-xs text-muted">
            {t(dict?.stats.coldStart, { keyCount })}
          </p>
        ) : null}
      </section>

      <section>
        <ChartCard
          title={
            axisFilterActive
              ? t(dict?.stats.skillEvolutionAxis, {
                  axis: skillAxisLabel(dict, skillAxis),
                })
              : dict?.stats.skillEvolution ?? "Skill evolution"
          }
        >
          {chartHistory.length === 0 ? (
            <EmptyChart message={notEnoughData} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartHistory}>
                <CartesianGrid stroke={charts.grid} vertical={false} />
                <XAxis
                  dataKey="at"
                  tick={charts.tick}
                  tickFormatter={formatChartDay}
                  minTickGap={28}
                  interval="preserveStartEnd"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={charts.tick}
                  width={40}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={charts.tooltip}
                  labelFormatter={formatChartDay}
                  formatter={(value, name) =>
                    skillTooltipFormatter(ratingMode, value, name, skillAxis)
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="push"
                  name={dict?.stats.bandPush ?? "Push"}
                  stroke={charts.chartAlt}
                  dot={false}
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  name={dict?.stats.bandAccuracy ?? "Accuracy"}
                  stroke={charts.chart}
                  dot={false}
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="consistency"
                  name={dict?.stats.bandConsistency ?? "Consistency"}
                  stroke={charts.chartCons}
                  dot={false}
                  strokeWidth={2.5}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">
          {dict?.stats.progression ?? "Progression"}
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={dict?.stats.weeklyActivity ?? "Weekly activity"}>
            {weekly.length === 0 ? (
              <EmptyChart message={notEnoughData} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weekly}>
                  <CartesianGrid
                    stroke={charts.grid}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="weekStart"
                    tick={charts.tick}
                    tickFormatter={formatChartDay}
                    minTickGap={28}
                    interval="preserveStartEnd"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={charts.tick}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={charts.tooltip}
                    labelFormatter={formatChartDay}
                  />
                  <Bar
                    dataKey="playCount"
                    fill={charts.chart}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title={dict?.stats.ppAccTrend ?? "PP / accuracy trend"}>
            {ppTrend.length === 0 && accTrend.length === 0 ? (
              <EmptyChart message={notEnoughData} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={ppTrend.map((p, i) => ({
                    day: p.day,
                    totalPp: p.totalPp,
                    avgAccuracy: (accTrend[i]?.avgAccuracy ?? 0) * 100,
                  }))}
                >
                  <CartesianGrid
                    stroke={charts.grid}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    tick={charts.tick}
                    tickFormatter={formatChartDay}
                    minTickGap={28}
                    interval="preserveStartEnd"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="pp"
                    tick={charts.tick}
                    width={40}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="acc"
                    orientation="right"
                    tick={charts.tick}
                    width={36}
                    domain={[0, 100]}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={charts.tooltip}
                    labelFormatter={formatChartDay}
                  />
                  <Line
                    yAxisId="pp"
                    type="monotone"
                    dataKey="totalPp"
                    name="PP"
                    stroke={charts.chartAlt}
                    dot={false}
                    strokeWidth={2.5}
                  />
                  <Line
                    yAxisId="acc"
                    type="monotone"
                    dataKey="avgAccuracy"
                    name="Acc %"
                    stroke={charts.chart}
                    dot={false}
                    strokeWidth={2.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">
          {dict?.stats.howYouPlay ?? "How you play"}
        </h2>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat
            label={dict?.stats.avgPlaysPerSession ?? "Avg plays / session"}
            value={
              sessions.avgPlaysPerSession > 0
                ? sessions.avgPlaysPerSession.toFixed(1)
                : "—"
            }
          />
          <Stat
            label={dict?.stats.avgSessionLength ?? "Avg session length"}
            value={formatDuration(sessions.avgDurationMs)}
          />
          <Stat
            label={dict?.stats.longestSession ?? "Longest session"}
            value={
              sessions.longest
                ? t(dict?.stats.playsCount, {
                    count: sessions.longest.scoreCount,
                  })
                : "—"
            }
            to={
              sessions.longest
                ? {
                    to: "/sessions/$sessionId",
                    params: { sessionId: String(sessions.longest.id) },
                  }
                : undefined
            }
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title={dict?.stats.rankDistribution ?? "Rank distribution"}>
            {ranks.every((r) => r.count === 0) ? (
              <EmptyChart message={notEnoughData} />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ranks}>
                    <CartesianGrid
                      stroke={charts.grid}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={charts.tick}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={charts.tick}
                      width={36}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={charts.tooltip} />
                    <Bar
                      dataKey="count"
                      fill={charts.chartCons}
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(_data, index) => {
                        const rank = ranks[index];
                        if (!rank || rank.count === 0) return;
                        openInPractice(
                          buildStatsGradeQuery(
                            keyCount,
                            skillAxis,
                            rank.label,
                          ),
                        );
                        void navigate({ to: "/practice" });
                      }}
                    >
                      {ranks.map((rank) => (
                        <Cell
                          key={rank.label}
                          fill={
                            rank.count === 0
                              ? "rgba(167, 167, 167, 0.35)"
                              : charts.chartCons
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-[11px] text-faint">
                  {dict?.stats.rankFootnote ??
                    "S includes SH · SS is Perfect/Marvelous only · X is a 1,000,000 score (all Marvelous)"}
                </p>
              </>
            )}
          </ChartCard>

          <ChartCard title={t(dict?.stats.skillsetMix, { keyCount })}>
            {mix == null || mix.total === 0 ? (
              <EmptyChart message={notEnoughData} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={skillsetBars}>
                  <CartesianGrid
                    stroke={charts.grid}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="axis"
                    tick={charts.tick}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={charts.tick}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={charts.tooltip}
                    formatter={(value, name) => {
                      if (name === "plays") {
                        return [
                          Number(value).toLocaleString(),
                          dict?.stats.plays ?? "plays",
                        ];
                      }
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="plays" fill={charts.chart} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title={dict?.stats.playsByWeekday ?? "Plays by weekday (UTC)"}>
            {byDow.every((d) => d.count === 0) ? (
              <EmptyChart message={notEnoughData} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byDow}>
                  <CartesianGrid
                    stroke={charts.grid}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={charts.tick}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={charts.tick}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={charts.tooltip} />
                  <Bar dataKey="count" fill={charts.chartAlt} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title={dict?.stats.playsByHour ?? "Plays by hour (UTC)"}>
            {byHour.every((h) => h.count === 0) ? (
              <EmptyChart message={notEnoughData} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byHour}>
                  <CartesianGrid
                    stroke={charts.grid}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="hour"
                    tick={charts.tick}
                    tickFormatter={(h) => `${h}h`}
                    minTickGap={12}
                    interval="preserveStartEnd"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={charts.tick}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={charts.tooltip}
                    labelFormatter={(h) => `${h}:00 UTC`}
                  />
                  <Bar dataKey="count" fill={charts.chartFln} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">
          {dict?.stats.topMappers ?? "Top mappers"}
        </h2>
        {mappers.length === 0 ? (
          <p className="text-sm text-muted">
            {dict?.stats.noMapperStats ??
              "No mapper stats yet — they fill in after the analytics pipeline runs."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {mappers.map((m, i) => (
              <li
                key={`${m.mapperOnlineId}-${m.mapperUsername ?? ""}`}
                className="rx-row"
              >
                <span className="w-8 shrink-0 tabular-nums text-faint">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">
                    {m.mapperUsername ??
                      t(dict?.stats.mapperFallback, { id: m.mapperOnlineId })}
                  </div>
                  <div className="text-sm text-muted">
                    {m.playCount.toLocaleString()}{" "}
                    {dict?.stats.plays ?? "plays"}
                    {m.avgAccuracy != null
                      ? ` · ${formatAccuracy(m.avgAccuracy)}`
                      : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums text-muted">
                  {formatPp(m.totalPp)}
                </div>
              </li>
            ))}
          </ul>
        )}
        {summary.firstPlayedAt || summary.lastPlayedAt ? (
          <p className="mt-4 text-xs text-faint">
            {dict?.stats.playHistory ?? "Play history"}
            {summary.firstPlayedAt
              ? ` ${dict?.stats.from ?? "from"} ${formatRelativeTime(summary.firstPlayedAt)}`
              : ""}
            {summary.lastPlayedAt
              ? ` · ${dict?.stats.last ?? "last"} ${formatRelativeTime(summary.lastPlayedAt)}`
              : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function SkillCard({
  mode,
  axis,
  dict,
  band,
  title,
  hint,
  value,
  maps,
  requiredPlays,
  expanded,
  onToggle,
  breakdown,
}: {
  mode: RatingDisplayMode;
  axis: StatsSkillAxis;
  dict: Dictionary["app"] | undefined;
  band: SkillBandKind;
  title: string;
  hint: string;
  value: number;
  maps: number;
  requiredPlays: number;
  expanded: boolean;
  onToggle: () => void;
  breakdown: {
    rc: number;
    ln: number;
    fln: number;
    rcMaps: number;
    lnMaps: number;
    flnMaps: number;
  } | null;
}) {
  const hasEstimate = value > 0;
  const playsLabel =
    maps === 0
      ? dict?.stats.noPlaysInBand ?? "No plays in band yet"
      : hasEstimate
        ? t(dict?.stats.mapsInBand, { count: maps })
        : t(dict?.stats.mapsInBandRequired, {
            count: maps,
            required: requiredPlays,
          });

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rx-panel w-full px-4 py-4 text-left transition ${
        expanded
          ? "ring-1 ring-accent/40"
          : "hover:bg-elevated/30"
      }`}
      aria-expanded={expanded}
      aria-controls={`skill-band-${band}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="rx-label">{title}</div>
        <span className="text-[10px] font-bold uppercase tracking-wide text-faint">
          {expanded
            ? dict?.stats.hide ?? "Hide"
            : dict?.stats.plays ?? "plays"}
        </span>
      </div>
      <div
        className={`mt-2 font-bold tabular-nums text-ink ${
          mode === "dan" ? "text-xl leading-snug" : "text-3xl"
        }`}
      >
        {hasEstimate
          ? formatSkillRating({
              mode,
              sunnyStar: value,
              axis: skillRatingAxis(axis),
            })
          : "—"}
      </div>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      {breakdown ? (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <AxisCell
            mode={mode}
            axis="rc"
            dict={dict}
            label={dict?.stats.axisRice ?? "Rice"}
            value={breakdown.rc}
            maps={breakdown.rcMaps}
            requiredPlays={requiredPlays}
          />
          <AxisCell
            mode={mode}
            axis="ln"
            dict={dict}
            label={dict?.stats.axisLn ?? "LN"}
            value={breakdown.ln}
            maps={breakdown.lnMaps}
            requiredPlays={requiredPlays}
          />
          <AxisCell
            mode={mode}
            axis="fln"
            dict={dict}
            label={dict?.stats.axisFln ?? "FLN"}
            value={breakdown.fln}
            maps={breakdown.flnMaps}
            requiredPlays={requiredPlays}
          />
        </div>
      ) : (
        <p className="mt-4 text-xs text-faint">
          {playsLabel}
          {!hasEstimate && maps > 0
            ? ` · ${t(dict?.stats.needMorePlays, {
                required: requiredPlays,
              })}`
            : ""}
        </p>
      )}
    </button>
  );
}

function SkillBandPlaysPanel({
  band,
  axis,
  dict,
  topPlays,
  keyCount,
  ratingMode,
}: {
  band: SkillBandKind;
  axis: StatsSkillAxis;
  dict: Dictionary["app"] | undefined;
  topPlays: number;
  keyCount: number;
  ratingMode: RatingDisplayMode;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["stats", "skill-plays", band, axis, topPlays, keyCount],
    queryFn: () =>
      fetchSkillBandPlays({
        band,
        axis: axis === "all" ? undefined : axis,
        topPlays,
        keyCount,
      }),
  });

  if (isLoading) {
    return (
      <div id={`skill-band-${band}`} className="rx-panel p-4">
        <SkeletonBlock className="h-5 w-36" />
        <SkeletonBlock className="mt-2 h-3 w-64 max-w-full" />
        <div className="mt-5">
          <ListSkeleton count={4} showThumbnail={false} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div id={`skill-band-${band}`} className="rx-panel p-4">
        <p className="text-sm text-rose-300">
          {error?.message ?? dict?.stats.failedToLoadPlays ?? "Failed to load plays"}
        </p>
      </div>
    );
  }

  const axisLabel = skillAxisLabel(dict, axis);
  const bandTitle =
    band === "push"
      ? dict?.stats.bandPush ?? "Push"
      : band === "accuracy"
        ? dict?.stats.bandAccuracy ?? "Accuracy"
        : dict?.stats.bandConsistency ?? "Consistency";

  return (
    <div id={`skill-band-${band}`} className="rx-panel space-y-6 p-4 sm:p-5">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">
          {t(dict?.stats.bandPlays, { band: bandTitle })}
          {axis !== "all" ? ` · ${axisLabel}` : ""}
        </h3>
        <p className="mt-1 text-xs text-muted">
          {t(dict?.stats.topHardest, { count: topPlays })}
        </p>
      </div>

      <SkillPlayList
        title={t(dict?.stats.inBand, {
          count: data.inBandTotal,
          total: topPlays,
        })}
        plays={data.inBand}
        ratingMode={ratingMode}
        empty={dict?.stats.emptyBand ?? "No plays in this band yet."}
      />

      {data.nextDanLabel ? (
        <SkillPlayList
          title={t(dict?.stats.nextDan, {
            label: data.nextDanLabel,
            count: data.inNextDanTotal,
            total: topPlays,
          })}
          plays={data.inNextDan}
          ratingMode={ratingMode}
          empty={t(dict?.stats.noLabelClears, {
            label: data.nextDanLabel,
          })}
        />
      ) : (
        <p className="text-sm text-muted">
          {dict?.stats.noNextDan ??
            "No higher dan tier above your current estimate."}
        </p>
      )}
    </div>
  );
}

function SkillPlayList({
  title,
  plays,
  ratingMode,
  empty,
}: {
  title: string;
  plays: Array<{
    beatmapId: string;
    title: string;
    artist: string;
    difficultyName: string;
    accuracy: number;
    sunnyStar: number;
    danLabel: string;
    playedAt: string | number | null;
  }>;
  ratingMode: RatingDisplayMode;
  empty: string;
}) {
  return (
    <section>
      <h4 className="mb-2 text-sm font-bold text-ink">{title}</h4>
      {plays.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {plays.map((play) => (
            <li key={`${play.beatmapId}-${play.playedAt}`}>
              <Link
                to="/practice/$beatmapId"
                params={{ beatmapId: play.beatmapId }}
                className="rx-row gap-3 !py-2 hover:bg-elevated/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">
                    {play.title}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted">
                    {play.artist}
                    {play.difficultyName ? ` · ${play.difficultyName}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <div className="font-semibold tabular-nums text-ink">
                    {formatAccuracy(play.accuracy)}
                  </div>
                  <div className="text-xs tabular-nums text-muted">
                    {ratingMode === "dan"
                      ? play.danLabel
                      : formatStars(play.sunnyStar)}
                    {" · "}
                    {play.playedAt != null
                      ? formatRelativeTime(String(play.playedAt))
                      : "—"}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AxisCell({
  mode,
  axis,
  dict,
  label,
  value,
  maps,
  requiredPlays,
}: {
  mode: RatingDisplayMode;
  axis: SkillRatingAxis;
  dict: Dictionary["app"] | undefined;
  label: string;
  value: number;
  maps: number;
  requiredPlays: number;
}) {
  const hasEstimate = value > 0 && maps >= requiredPlays;
  return (
    <div>
      <div className="text-faint">{label}</div>
      <div
        className={`mt-0.5 font-semibold tabular-nums text-ink ${
          mode === "dan" ? "text-[11px] leading-tight" : ""
        }`}
      >
        {hasEstimate
          ? formatSkillRating({ mode, sunnyStar: value, axis })
          : "—"}
      </div>
      <div className="text-[10px] text-faint">
        {maps >= requiredPlays
          ? t(dict?.stats.mapsCount, { count: maps })
          : maps > 0
            ? `${maps}/${requiredPlays}`
            : dict?.stats.zeroMaps ?? "0 maps"}
      </div>
    </div>
  );
}

function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-white/10 bg-panel p-0.5">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={`rounded px-2.5 py-1 text-xs font-bold transition ${
            value === opt.id
              ? "bg-accent/20 text-accent"
              : "text-muted hover:text-ink"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  to,
}: {
  label: string;
  value: string;
  to?: { to: "/sessions/$sessionId"; params: { sessionId: string } };
}) {
  const body = (
    <>
      <div className="rx-label">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</div>
    </>
  );
  if (to) {
    return (
      <Link
        to={to.to}
        params={to.params}
        className="rx-stat block transition hover:bg-elevated/30"
      >
        {body}
      </Link>
    );
  }
  return <div className="rx-stat">{body}</div>;
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rx-panel px-4 py-4 sm:px-5">
      <h3 className="mb-4 text-sm font-bold text-ink">{title}</h3>
      {children}
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <p className="py-12 text-center text-sm text-faint">{message}</p>
  );
}
