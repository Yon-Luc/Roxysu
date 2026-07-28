import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BeatmapCover } from "../../components/BeatmapCover";
import {
  ChartGridSkeleton,
  ListSkeleton,
  PageHeaderSkeleton,
  StatGridSkeleton,
} from "../../components/LoadingSkeleton";
import { ModBadges } from "../../components/ModBadges";
import { PageTitle } from "../../components/PageTitle";
import { fetchDashboard } from "../../lib/api";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
} from "../../lib/format";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { useChartStyles } from "../../lib/chartStyles";

export function DashboardPage() {
  const ratingMode = useRatingDisplayMode();
  const charts = useChartStyles();
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });

  if (isLoading) {
    return (
      <div className="space-y-10">
        <PageHeaderSkeleton />
        <StatGridSkeleton />
        <ChartGridSkeleton />
        <section>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div className="h-8 w-40 animate-pulse rounded-lg bg-white/6" />
            <div className="h-4 w-20 animate-pulse rounded-lg bg-white/6" />
          </div>
          <ListSkeleton count={5} />
        </section>
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-rose-300">
        Failed to load dashboard: {error?.message ?? "unknown error"}
      </p>
    );
  }

  const last = data.sync.lastImport;
  const session = data.currentSession;
  const weekly = data.weeklyActivity ?? [];
  const ppTrend = data.ppTrend ?? [];
  const accTrend = data.accuracyTrend ?? [];

  return (
    <div className="space-y-10">
      <div>
        <PageTitle>Home</PageTitle>
        <p className="rx-subtitle">
          Recent plays from your local osu!lazer database.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Scores indexed"
          value={data.sync.scoreCount.toLocaleString()}
        />
        <Stat
          label="Beatmaps"
          value={data.sync.beatmapCount.toLocaleString()}
        />
        <Stat
          label="Last sync"
          value={
            last
              ? `${last.status}${last.finishedAt ? ` · ${formatRelativeTime(last.finishedAt)}` : ""}`
              : "—"
          }
        />
        {session ? (
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: "current" }}
            className="rx-stat block transition hover:bg-elevated hover:ring-1 hover:ring-accent/40"
          >
            <div className="rx-label text-accent">Current session</div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-ink">
              {session.scoreCount} plays
            </div>
            <div className="mt-1 text-xs text-muted">
              {formatRelativeTime(session.startedAt)}
            </div>
          </Link>
        ) : (
          <Stat label="Current session" value="None" />
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Weekly activity">
          {weekly.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weekly}>
                <CartesianGrid stroke={charts.grid} vertical={false} />
                <XAxis
                  dataKey="weekStart"
                  tick={charts.tick}
                  tickFormatter={(v) => String(v).slice(5)}
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
                <Bar dataKey="playCount" fill={charts.chart} radius={[4, 4, 0, 0]} />
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
                <CartesianGrid stroke={charts.grid} vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={charts.tick}
                  tickFormatter={(v) => String(v).slice(5)}
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
                <Tooltip contentStyle={charts.tooltip} />
                <Line
                  yAxisId="pp"
                  type="monotone"
                  dataKey="totalPp"
                  stroke={charts.chartAlt}
                  dot={false}
                  strokeWidth={2.5}
                />
                <Line
                  yAxisId="acc"
                  type="monotone"
                  dataKey="avgAccuracy"
                  stroke={charts.chart}
                  dot={false}
                  strokeWidth={2.5}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
            Recent scores
          </h2>
          <Link
            to="/practice"
            className="text-sm font-bold text-muted transition hover:text-accent"
          >
            Practice →
          </Link>
        </div>
        {data.recentScores.length === 0 ? (
          <p className="text-sm text-muted">
            No scores yet. Run realm-reader to sync your client.realm.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {data.recentScores.map((score) => {
              const body = (
                <>
                  <BeatmapCover
                    backgroundFileHash={score.backgroundFileHash}
                    setOnlineId={score.setOnlineId}
                    size="list"
                    className="h-12 w-12 shrink-0 rounded shadow-md shadow-black/40"
                    alt=""
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink">
                      {score.title ?? "Untitled"}
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-muted">
                      <span className="truncate">
                        {score.artist ?? "Unknown"}
                        {score.difficultyName ? ` · ${score.difficultyName}` : ""}
                        {" · "}
                        {formatPrimaryRating({
                          mode: ratingMode,
                          starRating: score.starRating,
                          sunnyEstDiff: score.sunnyEstDiff,
                          sunnyStar: score.sunnyStar,
                        })}
                      </span>
                      <ModBadges mods={score.mods} />
                    </div>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <div className="font-semibold tabular-nums text-ink">
                      {formatAccuracy(score.accuracy)}
                    </div>
                    <div className="text-xs tabular-nums text-muted">
                      {formatPp(score.pp)} · {formatRelativeTime(score.playedAt)}
                    </div>
                  </div>
                </>
              );
              return (
                <li key={score.id}>
                  {score.beatmapId ? (
                    <Link
                      to="/practice/$beatmapId"
                      params={{ beatmapId: score.beatmapId }}
                      className="rx-row"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="rx-row">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
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
      No derived stats yet — analytics pipeline will fill this after sync.
    </p>
  );
}
