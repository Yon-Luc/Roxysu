import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchSession } from "../../lib/api";
import {
  formatAccuracy,
  formatMods,
  formatPp,
  formatRelativeTime,
  formatStars,
} from "../../lib/format";

export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["sessions", sessionId],
    queryFn: () => fetchSession(sessionId),
    enabled: Boolean(sessionId),
  });

  const knownIds = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    if (!data || !("scores" in data) || !data.scores) return;

    const incoming = data.scores.map((s) => s.id);
    if (!seeded.current) {
      knownIds.current = new Set(incoming);
      seeded.current = true;
      return;
    }

    const nextFresh = new Set<string>();
    for (const id of incoming) {
      if (!knownIds.current.has(id)) nextFresh.add(id);
    }
    if (nextFresh.size > 0) {
      knownIds.current = new Set(incoming);
      setFreshIds(nextFresh);
      const timer = window.setTimeout(() => setFreshIds(new Set()), 4_000);
      return () => window.clearTimeout(timer);
    }
  }, [data]);

  useEffect(() => {
    seeded.current = false;
    knownIds.current = new Set();
    setFreshIds(new Set());
  }, [sessionId]);

  if (isLoading) {
    return <p className="text-[#8b93a7]">Loading session…</p>;
  }

  if (error || !data || !("session" in data) || !data.session) {
    return (
      <div className="space-y-3">
        <Link to="/sessions" className="text-sm text-[#8b93a7] hover:text-white">
          ← Sessions
        </Link>
        <p className="text-rose-300">
          {error?.message ?? "Session not found"}
        </p>
      </div>
    );
  }

  const session = data.session;
  const scores = data.scores ?? [];
  const isLive = session.isCurrent;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/sessions" className="text-sm text-[#8b93a7] hover:text-white">
          ← Sessions
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {isLive ? "Current session" : `Session #${session.id}`}
          </h1>
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Live
              {isFetching ? <span className="text-emerald-400/70">· updating</span> : null}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-[#8b93a7]">
          Started {formatRelativeTime(session.startedAt)}
          {session.endedAt ? ` · ended ${formatRelativeTime(session.endedAt)}` : ""}
          {session.rulesetShortName ? ` · ${session.rulesetShortName}` : ""}
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <MiniStat label="Plays" value={String(session.scoreCount)} />
        <MiniStat label="PBs" value={String(data.pbCount ?? 0)} />
        <MiniStat
          label="Duration"
          value={formatSessionDuration(session.startedAt, session.endedAt)}
        />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-[#8b93a7]">
          Plays
        </h2>
        {scores.length === 0 ? (
          <p className="text-sm text-[#8b93a7]">
            {isLive
              ? "No plays yet — new scores will show up here after sync."
              : "No plays in this session."}
          </p>
        ) : (
          <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-[#151922]">
            {scores.map((score) => {
              const isFresh = freshIds.has(score.id);
              const body = (
                <>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-white">
                        {score.artist ?? "Unknown"} — {score.title ?? "Untitled"}
                        {score.difficultyName ? (
                          <span className="text-[#8b93a7]">
                            {" "}
                            [{score.difficultyName}]
                          </span>
                        ) : null}
                      </span>
                      {score.isPb ? (
                        <span className="shrink-0 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                          PB
                        </span>
                      ) : null}
                      {isFresh ? (
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                          New
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-xs text-[#8b93a7]">
                      {formatStars(score.starRating)} · {formatMods(score.mods)}
                      {score.retryIndex != null && score.retryIndex > 0
                        ? ` · retry #${score.retryIndex}`
                        : ""}
                      {" · "}
                      {formatRelativeTime(score.playedAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-4 text-sm tabular-nums">
                    <span className="text-white">{formatAccuracy(score.accuracy)}</span>
                    <span className="text-[#a8b0c0]">{formatPp(score.pp)}</span>
                    <span className="text-[#8b93a7]">{score.maxCombo}x</span>
                  </div>
                </>
              );

              return (
                <li
                  key={score.id}
                  className={
                    isFresh
                      ? "bg-emerald-500/[0.07] transition-colors duration-1000"
                      : undefined
                  }
                >
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
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#151922] px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-[#8b93a7]">
        {label}
      </div>
      <div className="mt-0.5 font-medium tabular-nums text-white">{value}</div>
    </div>
  );
}

function formatSessionDuration(
  startedAt: string,
  endedAt: string | null,
): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}
