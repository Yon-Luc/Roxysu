import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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

      <section className="grid gap-4 sm:grid-cols-3">
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
                  <div className="min-w-0">
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
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition hover:bg-white/[0.03]"
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <Placeholder
          title="Weekly activity"
          body="Charts arrive with the Statistics Engine (Phase 5)."
        />
        <Placeholder
          title="PP / accuracy trend"
          body="Trend series will live here once derived stats are computed."
        />
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

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-[#151922]/50 px-4 py-5">
      <h3 className="text-sm font-medium text-[#a8b0c0]">{title}</h3>
      <p className="mt-1 text-sm text-[#6b7385]">{body}</p>
    </div>
  );
}
