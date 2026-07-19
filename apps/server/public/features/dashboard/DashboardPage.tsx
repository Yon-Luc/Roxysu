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
import { fetchDashboard } from "../../lib/api";
import {
  formatAccuracy,
  formatMods,
  formatPp,
  formatRelativeTime,
  formatStars,
} from "../../lib/format";

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });

  if (isLoading) {
    return <p className="text-[#8b93a7]">Loading dashboard…</p>;
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
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-[#8b93a7]">
          Recent plays from your local osu!lazer database.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-4">
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
            className="rounded-lg border border-white/10 bg-[#151922] px-4 py-3 transition hover:border-emerald-500/30 hover:bg-emerald-500/5"
          >
            <div className="text-xs uppercase tracking-wider text-[#8b93a7]">
              Current session
            </div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-white">
              {session.scoreCount} plays ·{" "}
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
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="weekStart"
                  tick={{ fill: "#8b93a7", fontSize: 11 }}
                  tickFormatter={(v) => String(v).slice(5)}
                />
                <YAxis tick={{ fill: "#8b93a7", fontSize: 11 }} width={36} />
                <Tooltip
                  contentStyle={{
                    background: "#151922",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                  }}
                />
                <Bar dataKey="playCount" fill="#6b8afd" radius={[4, 4, 0, 0]} />
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
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: "#8b93a7", fontSize: 11 }}
                  tickFormatter={(v) => String(v).slice(5)}
                />
                <YAxis
                  yAxisId="pp"
                  tick={{ fill: "#8b93a7", fontSize: 11 }}
                  width={40}
                />
                <YAxis
                  yAxisId="acc"
                  orientation="right"
                  tick={{ fill: "#8b93a7", fontSize: 11 }}
                  width={36}
                  domain={[0, 100]}
                />
                <Tooltip
                  contentStyle={{
                    background: "#151922",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                  }}
                />
                <Line
                  yAxisId="pp"
                  type="monotone"
                  dataKey="totalPp"
                  stroke="#6b8afd"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  yAxisId="acc"
                  type="monotone"
                  dataKey="avgAccuracy"
                  stroke="#5ecf9a"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-[#8b93a7]">
          Recent scores
        </h2>
        {data.recentScores.length === 0 ? (
          <p className="text-sm text-[#8b93a7]">
            No scores yet. Run realm-reader to sync your client.realm.
          </p>
        ) : (
          <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-[#151922]">
            {data.recentScores.map((score) => {
              const body = (
                <>
                  <BeatmapCover
                    backgroundFileHash={score.backgroundFileHash}
                    setOnlineId={score.setOnlineId}
                    size="list"
                    className="h-12 w-[72px] shrink-0 rounded"
                    alt=""
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-white">
                      {score.artist ?? "Unknown"} — {score.title ?? "Untitled"}
                      {score.difficultyName ? (
                        <span className="text-[#8b93a7]">
                          {" "}
                          [{score.difficultyName}]
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-[#8b93a7]">
                      {formatStars(score.starRating)} · {formatMods(score.mods)}{" "}
                      · {formatRelativeTime(score.playedAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-4 text-sm tabular-nums">
                    <span>{formatAccuracy(score.accuracy)}</span>
                    <span className="text-[#a8b0c0]">{formatPp(score.pp)}</span>
                  </div>
                </>
              );
              return (
                <li key={score.id}>
                  {score.beatmapId ? (
                    <Link
                      to="/practice/$beatmapId"
                      params={{ beatmapId: score.beatmapId }}
                      className="flex flex-wrap items-center gap-3 px-4 py-3 transition hover:bg-white/[0.03]"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      {body}
                    </div>
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
    <div className="rounded-lg border border-white/10 bg-[#151922] px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-[#8b93a7]">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-white">
        {value}
      </div>
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
    <div className="rounded-lg border border-white/10 bg-[#151922] px-4 py-4">
      <h3 className="mb-3 text-sm font-medium text-[#a8b0c0]">{title}</h3>
      {children}
    </div>
  );
}

function EmptyChart() {
  return (
    <p className="py-12 text-center text-sm text-[#6b7385]">
      No derived stats yet — analytics pipeline will fill this after sync.
    </p>
  );
}
