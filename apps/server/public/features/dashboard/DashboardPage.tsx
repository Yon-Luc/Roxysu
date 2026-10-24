import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BeatmapCover } from "../../components/BeatmapCover";
import {
  ChartGridSkeleton,
  ListSkeleton,
  StatGridSkeleton,
} from "../../components/LoadingSkeleton";
import { ModBadges } from "../../components/ModBadges";
import { PageTitle } from "../../components/PageTitle";
import { ChartCard } from "../../components/ChartCard";
import { EmptyChart } from "../../components/EmptyChart";
import { Stat } from "../../components/Stat";
import { fetchDashboard } from "../../lib/api";
import { useAppDict } from "../../lib/i18n";
import {
  formatAccuracy,
  formatChartDay,
  formatPp,
  formatRelativeTime,
} from "../../lib/format";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { useChartStyles } from "../../lib/chartStyles";
import { formatDuration } from "../stats/statsHelpers";
import roxyIcon from "../../roxy.png";

export function DashboardPage() {
  const ratingMode = useRatingDisplayMode();
  const charts = useChartStyles();
  const { dict } = useAppDict();
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });

  if (isLoading) {
    return (
      <div className="space-y-10">
        <div className="flex items-center gap-3">
          <img
            src={roxyIcon}
            alt=""
            className="size-10 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0">
            <PageTitle>{dict?.nav.home ?? "Home"}</PageTitle>
            <p className="rx-subtitle" aria-live="polite">
              {dict?.dashboard.loadingSummary ?? "Loading practice summary…"}
            </p>
          </div>
        </div>
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
      <p className="text-danger">
        Failed to load dashboard: {error?.message ?? "unknown error"}
      </p>
    );
  }

  const last = data.sync.lastImport;
  const session = data.currentSession;
  const weekly = data.weeklyActivity ?? [];
  const snapshot = data.practiceSnapshot;
  const lastClosed = snapshot?.lastSession ?? null;

  const lastSyncLabel = last
    ? `${dict?.sync.status[last.status] ?? last.status}${last.finishedAt ? ` · ${formatRelativeTime(last.finishedAt, dict?.common)}` : ""}`
    : "—";

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>{dict?.nav.home ?? "Home"}</PageTitle>
        <p className="rx-subtitle">
          {dict?.dashboard.subtitle ??
            "Recent plays from your local osu!lazer database."}
        </p>
        <p className="mt-2 text-xs text-faint">
          {data.sync.scoreCount.toLocaleString()}{" "}
          {dict?.dashboard.scoresIndexed ?? "Scores indexed"}
          {" · "}
          {data.sync.beatmapCount.toLocaleString()}{" "}
          {dict?.dashboard.beatmaps ?? "Beatmaps"}
          {" · "}
          {dict?.dashboard.lastSync ?? "Last sync"} {lastSyncLabel}
        </p>
      </div>

      {session ? (
        <Link
          to="/sessions/$sessionId"
          params={{ sessionId: "current" }}
          className="rx-panel flex flex-wrap items-end justify-between gap-3 px-4 py-4 transition hover:bg-elevated sm:px-5"
        >
          <div className="min-w-0">
            <div className="rx-label text-accent">
              {dict?.dashboard.currentSession ?? "Current session"}
            </div>
            <div className="mt-1 truncate font-display text-2xl font-bold text-ink">
              {session.name}
            </div>
          </div>
          <div className="text-sm text-muted">
            {session.scoreCount} {dict?.dashboard.plays ?? "plays"}
            {" · "}
            {formatRelativeTime(session.startedAt, dict?.common)}
          </div>
        </Link>
      ) : (
        <div className="rx-panel px-4 py-4 sm:px-5">
          <div className="rx-label">
            {dict?.dashboard.currentSession ?? "Current session"}
          </div>
          <div className="mt-1 text-lg font-bold text-muted">
            {dict?.dashboard.none ?? "None"}
          </div>
        </div>
      )}

      <section>
        <h2 className="mb-3 font-display text-lg font-bold tracking-tight text-ink">
          {dict?.dashboard.practiceSnapshot ?? "Practice snapshot"}
        </h2>
        {!snapshot ? (
          <p className="text-sm text-muted">
            {dict?.dashboard.noDerivedStats ??
              "No derived stats yet — analytics pipeline will fill this after sync."}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={dict?.dashboard.playsToday ?? "Plays today"}
              value={snapshot.playsToday.toLocaleString()}
            />
            <Stat
              label={dict?.dashboard.playsLast7Days ?? "Last 7 days"}
              value={snapshot.playsLast7Days.toLocaleString()}
            />
            <Stat
              label={dict?.dashboard.activeDayStreak ?? "Active-day streak"}
              value={snapshot.activeDayStreak.toLocaleString()}
            />
            {lastClosed ? (
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: String(lastClosed.id) }}
                className="rx-stat block transition hover:bg-elevated"
              >
                <div className="rx-label">
                  {dict?.dashboard.lastSession ?? "Last session"}
                </div>
                <div className="mt-2 truncate text-lg font-bold text-ink">
                  {lastClosed.name}
                </div>
                <div className="mt-1 text-xs text-muted">
                  {lastClosed.scoreCount} {dict?.dashboard.plays ?? "plays"}
                  {" · "}
                  {formatDuration(lastClosed.durationMs)}
                  {" · "}
                  {lastClosed.pbCount} {dict?.dashboard.pbs ?? "PBs"}
                  {lastClosed.endedAt
                    ? ` · ${formatRelativeTime(lastClosed.endedAt, dict?.common)}`
                    : null}
                </div>
              </Link>
            ) : (
              <Stat
                label={dict?.dashboard.lastSession ?? "Last session"}
                value={dict?.dashboard.noSessionsYet ?? "No sessions yet"}
              />
            )}
          </div>
        )}
      </section>

      <section>
        <ChartCard title={dict?.dashboard.weeklyActivity ?? "Weekly activity"}>
          {weekly.length === 0 ? (
            <EmptyChart
              message={
                dict?.dashboard.noDerivedStats ??
                "No derived stats yet — analytics pipeline will fill this after sync."
              }
            />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={weekly}>
                <CartesianGrid stroke={charts.grid} vertical={false} />
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
                <Bar dataKey="playCount" fill={charts.chart} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            {dict?.dashboard.recentScores ?? "Recent scores"}
          </h2>
          <Link
            to="/practice"
            className="text-sm font-bold text-muted transition hover:text-accent"
          >
            {dict?.dashboard.seeMore ?? "See more"} →
          </Link>
        </div>
        {data.recentScores.length === 0 ? (
          <p className="text-sm text-muted">
            {dict?.dashboard.noScoresYet ??
              "No scores yet. Run realm-reader to sync your client.realm."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {data.recentScores.map((score) => {
              const beatmapMissing = !score.beatmapId;
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
                      {beatmapMissing
                        ? (dict?.dashboard.beatmapDeleted ?? "Beatmap deleted")
                        : (score.title ?? dict?.dashboard.untitled ?? "Untitled")}
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-muted">
                      <span className="truncate">
                        {beatmapMissing ? (
                          dict?.dashboard.removedFromGame ?? "Removed from the game"
                        ) : (
                          <>
                            {score.artist ?? dict?.dashboard.unknown ?? "Unknown"}
                            {score.difficultyName ? ` · ${score.difficultyName}` : ""}
                            {" · "}
                            {formatPrimaryRating({
                              mode: ratingMode,
                              starRating: score.starRating,
                              reworkEstDiff: score.reworkEstDiff,
                              reworkStar: score.reworkStar,
                              lnRatio: score.reworkLnRatio,
                              keyCount: score.keyCount,
                            })}
                          </>
                        )}
                      </span>
                      <ModBadges mods={score.mods} />
                    </div>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <div className="font-semibold tabular-nums text-ink">
                      {formatAccuracy(score.accuracy)}
                    </div>
                    <div className="text-xs tabular-nums text-muted">
                      {formatPp(score.pp)} · {formatRelativeTime(score.playedAt, dict?.common)}
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
