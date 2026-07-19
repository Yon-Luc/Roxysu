import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { BeatmapCover } from "../../components/BeatmapCover";
import { fetchSession } from "../../lib/api";
import {
  formatAccuracy,
  formatMods,
  formatPp,
  formatRelativeTime,
} from "../../lib/format";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { SessionUpNext } from "./SessionUpNext";
import { SessionSevenKRecommend } from "./SessionSevenKRecommend";

export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const ratingMode = useRatingDisplayMode();
  const isCurrentHub = sessionId === "current";

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
    return <p className="text-muted">Loading session…</p>;
  }

  if (error || !data || !("session" in data)) {
    return (
      <div className="space-y-3">
        <Link to="/sessions" className="rx-back">
          ← Sessions
        </Link>
        <p className="text-rose-300">
          {error?.message ?? "Session not found"}
        </p>
      </div>
    );
  }

  if ("error" in data) {
    return (
      <div className="space-y-3">
        <Link to="/sessions" className="rx-back">
          ← Sessions
        </Link>
        <p className="text-rose-300">{data.error}</p>
      </div>
    );
  }

  const idle = "idle" in data && data.idle === true && data.session == null;
  const session = data.session;
  const scores = data.scores ?? [];
  const isLive = Boolean(session?.isCurrent);

  if (idle || (isCurrentHub && !session)) {
    return (
      <div className="space-y-8">
        <div>
          <Link to="/sessions" className="rx-back">
            ← Sessions
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="rx-title">Start a session</h1>
          </div>
          <p className="rx-subtitle">
            No live session yet. Pick a map below — the next sync after you play
            opens a current session.
          </p>
        </div>

        <SessionUpNext
          isIdle
          rulesetShortName={null}
          excludeBeatmapIds={[]}
        />

        <SessionSevenKRecommend excludeBeatmapIds={[]} />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-3">
        <Link to="/sessions" className="rx-back">
          ← Sessions
        </Link>
        <p className="text-rose-300">Session not found</p>
      </div>
    );
  }

  const excludeBeatmapIds = [
    ...new Set(
      scores
        .map((s) => s.beatmapId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  return (
    <div className="space-y-8">
      <div>
        <Link to="/sessions" className="rx-back">
          ← Sessions
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="rx-title">
            {isLive ? "Current session" : `Session #${session.id}`}
          </h1>
          {isLive ? (
            <span className="rx-chip bg-accent-glow text-accent">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              Live
              {isFetching ? (
                <span className="text-accent/70">· updating</span>
              ) : null}
            </span>
          ) : null}
        </div>
        <p className="rx-subtitle">
          Started {formatRelativeTime(session.startedAt)}
          {session.endedAt
            ? ` · ended ${formatRelativeTime(session.endedAt)}`
            : ""}
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

      {isCurrentHub ? (
        <>
          <SessionUpNext
            isIdle={false}
            rulesetShortName={session.rulesetShortName}
            excludeBeatmapIds={excludeBeatmapIds}
          />
          <SessionSevenKRecommend excludeBeatmapIds={excludeBeatmapIds} />
        </>
      ) : null}

      <section>
        <h2 className="mb-3 font-display text-2xl font-bold tracking-tight text-ink">
          Plays
        </h2>
        {scores.length === 0 ? (
          <p className="text-sm text-muted">
            {isLive
              ? "No plays yet — new scores will show up here after sync."
              : "No plays in this session."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {scores.map((score) => {
              const isFresh = freshIds.has(score.id);
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-ink">
                        {score.title ?? "Untitled"}
                      </span>
                      {score.isPb ? (
                        <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                          PB
                        </span>
                      ) : null}
                      {isFresh ? (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-accent">
                          New
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-sm text-muted">
                      {score.artist ?? "Unknown"}
                      {score.difficultyName ? ` · ${score.difficultyName}` : ""}
                      {" · "}
                      {formatPrimaryRating({
                        mode: ratingMode,
                        starRating: score.starRating,
                        sunnyEstDiff: score.sunnyEstDiff,
                        sunnyStar: score.sunnyStar,
                      })}{" "}
                      · {formatMods(score.mods)}
                      {score.retryIndex != null && score.retryIndex > 0
                        ? ` · retry #${score.retryIndex}`
                        : ""}
                    </div>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <div className="font-semibold tabular-nums text-ink">
                      {formatAccuracy(score.accuracy)}
                    </div>
                    <div className="text-xs tabular-nums text-muted">
                      {formatPp(score.pp)} · {score.maxCombo}x ·{" "}
                      {formatRelativeTime(score.playedAt)}
                    </div>
                  </div>
                </>
              );

              return (
                <li
                  key={score.id}
                  className={
                    isFresh
                      ? "rounded-md bg-accent/10 transition-colors duration-1000"
                      : undefined
                  }
                >
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rx-stat">
      <div className="rx-label">{label}</div>
      <div className="mt-1.5 text-lg font-bold tabular-nums text-ink">{value}</div>
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
