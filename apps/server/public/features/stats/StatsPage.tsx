import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  fetchStats,
  type StatsGranularity,
  type StatsRange,
} from "../../lib/api";
import { formatAccuracy, formatPp, formatRelativeTime } from "../../lib/format";
import {
  formatSkillRating,
  useRatingDisplayMode,
  type RatingDisplayMode,
  type SkillRatingAxis,
} from "../../lib/ratingDisplay";

const chartTick = { fill: "#a7a7a7", fontSize: 11 };
const tooltipStyle = {
  background: "#242424",
  border: "none",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
};

const PUSH_COLOR = "#e879a8";
const ACC_COLOR = "#7c8fe0";
const CONS_COLOR = "#5ec4a8";
const RC_COLOR = "#7c8fe0";
const LN_COLOR = "#e879a8";
const FLN_COLOR = "#c9a227";

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function skillTooltipFormatter(
  mode: RatingDisplayMode,
  value: unknown,
  name: unknown,
): [string, string] {
  const label = String(name ?? "");
  const n = typeof value === "number" ? value : Number(value);
  return [
    formatSkillRating({ mode, sunnyStar: n, axis: "overall" }),
    label,
  ];
}

export function StatsPage({
  granularity,
  range,
  onGranularityChange,
  onRangeChange,
}: {
  granularity: StatsGranularity;
  range: StatsRange;
  onGranularityChange: (g: StatsGranularity) => void;
  onRangeChange: (r: StatsRange) => void;
}) {
  const ratingMode = useRatingDisplayMode();
  const { data, isLoading, error } = useQuery({
    queryKey: ["stats", granularity, range],
    queryFn: () => fetchStats({ granularity, range }),
  });

  if (isLoading) {
    return <p className="text-muted">Loading stats…</p>;
  }

  if (error || !data) {
    return (
      <p className="text-rose-300">
        Failed to load stats: {error?.message ?? "unknown error"}
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
    { axis: "Rice", plays: mix?.rc ?? 0, pct: mix?.rcPct ?? 0 },
    { axis: "LN", plays: mix?.ln ?? 0, pct: mix?.lnPct ?? 0 },
    { axis: "FLN", plays: mix?.fln ?? 0, pct: mix?.flnPct ?? 0 },
  ];

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <PageTitle>Stats</PageTitle>
          <p className="rx-subtitle">
            Skill evolution, progression, and how you play — times in UTC.
            Skill uses your Settings rating display (Sunny ★ or dan).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            value={granularity}
            options={[
              { id: "day", label: "Day" },
              { id: "week", label: "Week" },
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

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Scores" value={summary.scoreCount.toLocaleString()} />
        <Stat
          label="Maps played"
          value={summary.distinctMapsPlayed.toLocaleString()}
        />
        <Stat label="PBs" value={summary.pbCount.toLocaleString()} />
        <Stat
          label="Sessions"
          value={summary.sessionCount.toLocaleString()}
        />
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">
          Current skill
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <SkillCard
            mode={ratingMode}
            title="Push"
            hint="90–95% clears"
            overall={skill.peakOverall}
            rc={skill.peakRc}
            ln={skill.peakLn}
            fln={skill.peakFln}
            rcMaps={skill.clearRcMaps}
            lnMaps={skill.clearLnMaps}
            flnMaps={skill.clearFlnMaps}
          />
          <SkillCard
            mode={ratingMode}
            title="Accuracy"
            hint="99%+ clears"
            overall={skill.accuracyOverall}
            rc={skill.accuracyRc}
            ln={skill.accuracyLn}
            fln={skill.accuracyFln}
            rcMaps={skill.accuracyRcMaps}
            lnMaps={skill.accuracyLnMaps}
            flnMaps={skill.accuracyFlnMaps}
          />
          <SkillCard
            mode={ratingMode}
            title="Consistency"
            hint="96–99% clears"
            overall={skill.consistencyOverall}
            rc={skill.consistencyRc}
            ln={skill.consistencyLn}
            fln={skill.consistencyFln}
            rcMaps={skill.consistencyRcMaps}
            lnMaps={skill.consistencyLnMaps}
            flnMaps={skill.consistencyFlnMaps}
          />
        </div>
        {skill.coldStart ? (
          <p className="mt-3 text-xs text-muted">
            Cold-start estimate — play more 7K maps for a firmer reading.
          </p>
        ) : null}
      </section>

      <section>
        <ChartCard title="Skill evolution">
          {history.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={history}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="at"
                  tick={chartTick}
                  tickFormatter={(v) => String(v).slice(5)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={chartTick}
                  width={40}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value, name) =>
                    skillTooltipFormatter(ratingMode, value, name)
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="push"
                  name="Push"
                  stroke={PUSH_COLOR}
                  dot={false}
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  name="Accuracy"
                  stroke={ACC_COLOR}
                  dot={false}
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="consistency"
                  name="Consistency"
                  stroke={CONS_COLOR}
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
          Progression
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Weekly activity">
            {weekly.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={weekly}>
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.06)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="weekStart"
                    tick={chartTick}
                    tickFormatter={(v) => String(v).slice(5)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={chartTick}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar
                    dataKey="playCount"
                    fill={ACC_COLOR}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="PP / accuracy trend">
            {ppTrend.length === 0 && accTrend.length === 0 ? (
              <EmptyChart />
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
                    stroke="rgba(255,255,255,0.06)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="day"
                    tick={chartTick}
                    tickFormatter={(v) => String(v).slice(5)}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="pp"
                    tick={chartTick}
                    width={40}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="acc"
                    orientation="right"
                    tick={chartTick}
                    width={36}
                    domain={[0, 100]}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    yAxisId="pp"
                    type="monotone"
                    dataKey="totalPp"
                    name="PP"
                    stroke={PUSH_COLOR}
                    dot={false}
                    strokeWidth={2.5}
                  />
                  <Line
                    yAxisId="acc"
                    type="monotone"
                    dataKey="avgAccuracy"
                    name="Acc %"
                    stroke={ACC_COLOR}
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
          How you play
        </h2>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Avg plays / session"
            value={
              sessions.avgPlaysPerSession > 0
                ? sessions.avgPlaysPerSession.toFixed(1)
                : "—"
            }
          />
          <Stat
            label="Avg session length"
            value={formatDuration(sessions.avgDurationMs)}
          />
          <Stat
            label="Longest session"
            value={
              sessions.longest
                ? `${sessions.longest.scoreCount} plays`
                : "—"
            }
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Rank distribution">
            {ranks.every((r) => r.count === 0) ? (
              <EmptyChart />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={ranks}>
                    <CartesianGrid
                      stroke="rgba(255,255,255,0.06)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={chartTick}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={chartTick}
                      width={36}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" fill={CONS_COLOR} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-[11px] text-faint">
                  S includes SH · X is SS (X/XH) or a 1,000,000 score
                </p>
              </>
            )}
          </ChartCard>

          <ChartCard title="7K skillset mix">
            {mix == null || mix.total === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={skillsetBars}>
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.06)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="axis"
                    tick={chartTick}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={chartTick}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) => {
                      if (name === "plays") {
                        return [Number(value).toLocaleString(), "Plays"];
                      }
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="plays" fill={RC_COLOR} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Plays by weekday (UTC)">
            {byDow.every((d) => d.count === 0) ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byDow}>
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.06)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={chartTick}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={chartTick}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill={LN_COLOR} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Plays by hour (UTC)">
            {byHour.every((h) => h.count === 0) ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byHour}>
                  <CartesianGrid
                    stroke="rgba(255,255,255,0.06)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="hour"
                    tick={chartTick}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={chartTick}
                    width={36}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill={FLN_COLOR} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl font-bold tracking-tight text-ink">
          Top mappers
        </h2>
        {mappers.length === 0 ? (
          <p className="text-sm text-muted">
            No mapper stats yet — they fill in after the analytics pipeline runs.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {mappers.map((m, i) => (
              <li key={m.mapperOnlineId} className="rx-row">
                <span className="w-8 shrink-0 tabular-nums text-faint">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">
                    {m.mapperUsername ?? `Mapper #${m.mapperOnlineId}`}
                  </div>
                  <div className="text-sm text-muted">
                    {m.playCount.toLocaleString()} plays
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
            Play history
            {summary.firstPlayedAt
              ? ` from ${formatRelativeTime(summary.firstPlayedAt)}`
              : ""}
            {summary.lastPlayedAt
              ? ` · last ${formatRelativeTime(summary.lastPlayedAt)}`
              : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function SkillCard({
  mode,
  title,
  hint,
  overall,
  rc,
  ln,
  fln,
  rcMaps,
  lnMaps,
  flnMaps,
}: {
  mode: RatingDisplayMode;
  title: string;
  hint: string;
  overall: number;
  rc: number;
  ln: number;
  fln: number;
  rcMaps: number;
  lnMaps: number;
  flnMaps: number;
}) {
  return (
    <div className="rx-panel px-4 py-4">
      <div className="rx-label">{title}</div>
      <div
        className={`mt-2 font-bold tabular-nums text-ink ${
          mode === "dan" ? "text-xl leading-snug" : "text-3xl"
        }`}
      >
        {formatSkillRating({ mode, sunnyStar: overall, axis: "overall" })}
      </div>
      <p className="mt-1 text-xs text-muted">{hint}</p>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <AxisCell mode={mode} axis="rc" label="Rice" value={rc} maps={rcMaps} />
        <AxisCell mode={mode} axis="ln" label="LN" value={ln} maps={lnMaps} />
        <AxisCell
          mode={mode}
          axis="fln"
          label="FLN"
          value={fln}
          maps={flnMaps}
        />
      </div>
    </div>
  );
}

function AxisCell({
  mode,
  axis,
  label,
  value,
  maps,
}: {
  mode: RatingDisplayMode;
  axis: SkillRatingAxis;
  label: string;
  value: number;
  maps: number;
}) {
  return (
    <div>
      <div className="text-faint">{label}</div>
      <div
        className={`mt-0.5 font-semibold tabular-nums text-ink ${
          mode === "dan" ? "text-[11px] leading-tight" : ""
        }`}
      >
        {formatSkillRating({ mode, sunnyStar: value, axis })}
      </div>
      <div className="text-[10px] text-faint">{maps} maps</div>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rx-stat">
      <div className="rx-label">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
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

function EmptyChart() {
  return (
    <p className="py-12 text-center text-sm text-faint">
      Not enough data yet.
    </p>
  );
}
