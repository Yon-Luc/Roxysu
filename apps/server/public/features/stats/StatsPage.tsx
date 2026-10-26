import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  formatStars,
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
  const [belowFoldReady, setBelowFoldReady] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setBelowFoldReady(true), 0);
    return () => window.clearTimeout(id);
  }, []);

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
    placeholderData: keepPreviousData,
  });

  const history = data?.skillHistory ?? [];
  const accTrend = data?.accuracyTrend ?? [];

  // Must stay above loading/error returns — Rules of Hooks.
  const chartHistory = useMemo(
    () =>
      history.map((point) => ({
        at: point.at,
        push: historyBandValue(point, "push", skillAxis),
        accuracy: historyBandValue(point, "accuracy", skillAxis),
        consistency: historyBandValue(point, "consistency", skillAxis),
      })),
    [history, skillAxis],
  );
  const accChart = useMemo(
    () =>
      accTrend.map((p) => ({
        day: p.day,
        avgAccuracy: p.avgAccuracy == null ? null : p.avgAccuracy * 100,
        plays: p.playCount,
      })),
    [accTrend],
  );
  // Floor the axis 5 points under the worst day (>= 0); ceiling stays at 100
  // so per-day accuracy differences stay visible for high-accuracy players.
  const accDomain = useMemo<[number, number]>(() => {
    const points = accChart
      .map((p) => p.avgAccuracy)
      .filter((v): v is number => v != null);
    if (points.length === 0) return [95, 100];
    return [Math.max(0, Math.floor(Math.min(...points) - 5)), 100];
  }, [accChart]);

  const axisToggle = (
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
  );
  function rangeToggle() {
    return (
      <ToggleGroup
        value={String(range)}
        options={[
          { id: "30", label: "30d" },
          { id: "90", label: "90d" },
          { id: "180", label: "180d" },
        ]}
        onChange={(v) => onRangeChange(Number(v) as StatsRange)}
      />
    );
  }
  const granularityToggle = (
    <ToggleGroup
      value={granularity}
      options={[
        { id: "day", label: dict?.stats.day ?? "Day" },
        { id: "week", label: dict?.stats.week ?? "Week" },
      ]}
      onChange={onGranularityChange}
    />
  );
  const topPlaysControl = (
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
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-10">
        <PageHeaderSkeleton
          actions={<SkeletonBlock className="h-9 w-28 rounded-md" />}
        />
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
      <p className="text-danger">
        {t(dict?.stats.failedToLoadStats, {
          error: error?.message ?? "unknown error",
        })}
      </p>
    );
  }

  const skill = data.skill;
  const weekly = data.weeklyActivity ?? [];
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

  const axisFilterActive = skillAxis !== "all";
  const notEnoughData = dict?.stats.notEnoughData ?? "Not enough data yet.";

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <PageTitle>{dict?.nav.stats ?? "Stats"}</PageTitle>
          <p className="rx-subtitle">
            {t(dict?.stats.pageHint, { keyCount })}
            {axisFilterActive
              ? ` · ${t(dict?.stats.axisOnly, {
                  axis: skillAxisLabel(dict, skillAxis),
                })}`
              : ""}
          </p>
        </div>
        <ToggleGroup
          value={String(keyCount)}
          options={(data.availableKeyCounts ?? [4, 7]).map((k) => ({
            id: String(k),
            label: `${k}K`,
          }))}
          onChange={(v) => onKeyCountChange(Number(v))}
        />
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
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">
              {dict?.stats.currentSkill ?? "Current skill"}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {axisToggle}
              {topPlaysControl}
            </div>
          </div>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer font-medium text-subtle">
              {dict?.stats.skillRulesLabel ?? "How skill is calculated"}
            </summary>
            <p className="mt-1 max-w-3xl leading-relaxed">
              {t(dict?.stats.subtitle, { keyCount, topPlays: skillTopPlays })}
            </p>
          </details>
        </div>
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
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {granularityToggle}
              {rangeToggle()}
            </div>
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

      {belowFoldReady ? (
        <>
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            {dict?.stats.progression ?? "Progression"}
          </h2>
          {rangeToggle()}
        </div>
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

          <ChartCard title={dict?.stats.accuracyTrend ?? "Accuracy trend"}>
            {accTrend.length === 0 ? (
              <EmptyChart message={notEnoughData} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={accChart}>
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
                    tick={charts.tick}
                    width={40}
                    axisLine={false}
                    tickLine={false}
                    domain={accDomain}
                  />
                  <Tooltip
                    contentStyle={charts.tooltip}
                    labelFormatter={formatChartDay}
                    formatter={(value, name) =>
                      name === "plays"
                        ? [String(value), dict?.stats.plays ?? "Plays"]
                        : [
                            `${Number(value).toFixed(2)}%`,
                            dict?.stats.bandAccuracy ?? "Accuracy",
                          ]
                    }
                  />
                  <Line
                    stroke="none"
                    dataKey="plays"
                    name={dict?.stats.plays ?? "Plays"}
                    legendType="none"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgAccuracy"
                    name={dict?.stats.bandAccuracy ?? "Accuracy"}
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
        <h2 className="mb-4 font-display text-lg font-bold tracking-tight text-ink">
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
        <h2 className="mb-4 font-display text-lg font-bold tracking-tight text-ink">
          {dict?.stats.topMappers ?? "Top mappers"}
        </h2>
        {mappers.length === 0 ? (
          <p className="text-sm text-muted">
            {dict?.stats.noMapperStats ??
              "No mapper stats yet — they appear as soon as you play mapped charts."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="px-2 py-2 font-semibold">
                    {dict?.stats.colRank ?? "#"}
                  </th>
                  <th className="px-2 py-2 font-semibold">
                    {dict?.stats.colMapper ?? "Mapper"}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">
                    {dict?.stats.colPlays ?? "Plays"}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">
                    {dict?.stats.colMaps ?? "Maps"}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">
                    {dict?.stats.colAccuracy ?? "Acc"}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">
                    {dict?.stats.colSessions ?? "Sessions"}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">
                    {dict?.stats.colMapType ?? "Rice / LN / FLN"}
                  </th>
                  <th className="px-2 py-2 text-right font-semibold">
                    {dict?.stats.colAvgStar ?? "Avg ★ (rework)"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {mappers.map((m, i) => (
                  <tr
                    key={`${m.mapperOnlineId}-${m.mapperUsername ?? ""}`}
                    className="border-b border-line/60 transition-colors hover:bg-elevated/40"
                  >
                    <td className="px-2 py-2 tabular-nums text-faint">
                      {i + 1}
                    </td>
                    <td className="px-2 py-2 font-semibold text-ink">
                      {m.mapperUsername ??
                        t(dict?.stats.mapperFallback, {
                          id: m.mapperOnlineId,
                        })}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">
                      {m.playCount.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-ink">
                      {m.mapsPlayed.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted">
                      {formatAccuracy(m.avgAccuracy)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted">
                      {m.sessionCount.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-mono text-muted">
                      {m.ratedMaps > 0
                        ? `${m.rcMaps} / ${m.lnMaps} / ${m.flnMaps}`
                        : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-mono text-muted">
                      {formatStars(m.avgStar)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {summary.firstPlayedAt || summary.lastPlayedAt ? (
          <p className="mt-4 text-xs text-faint">
            {dict?.stats.playHistory ?? "Play history"}
            {summary.firstPlayedAt
              ? ` ${dict?.stats.from ?? "from"} ${formatRelativeTime(summary.firstPlayedAt, dict?.common)}`
              : ""}
            {summary.lastPlayedAt
              ? ` · ${dict?.stats.last ?? "last"} ${formatRelativeTime(summary.lastPlayedAt, dict?.common)}`
              : ""}
          </p>
        ) : null}
      </section>
        </>
      ) : (
        <PanelSkeleton lines={4} className="min-h-[22rem]" />
      )}
    </div>
  );
}
