import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { ChartCard } from "../../components/ChartCard";
import { EmptyChart } from "../../components/EmptyChart";
import { Stat } from "../../components/Stat";
import { ToggleGroup } from "../../components/ToggleGroup";
import { SkillCard } from "./components/SkillCard";
import { SkillBandPlaysPanel } from "./components/SkillBandPlaysPanel";
import {
  formatDuration,
  historyBandValue,
  skillAxisLabel,
  skillBandMaps,
  skillBandValue,
  skillTooltipFormatter,
} from "./statsHelpers";
import {
  fetchStats,
  type SkillBandKind,
  type StatsGranularity,
  type StatsRange,
  type StatsSkillAxis,
} from "../../lib/api";
import {
  formatAccuracy,
  formatChartDay,
  formatPp,
  formatRelativeTime,
} from "../../lib/format";
import {
  useRatingDisplayMode,
  type RatingDisplayMode,
} from "../../lib/ratingDisplay";
import { useChartStyles } from "../../lib/chartStyles";
import { useAppDict, t } from "../../lib/i18n";
import {
  buildStatsGradeQuery,
  openInPractice,
} from "../../lib/practiceSearch";

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
    // Stats only change after a sync completes; SSE sync.finished invalidates
    // this. Explicit staleTime prevents unnecessary refetches on tab focus.
    staleTime: 5 * 60_000,
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
