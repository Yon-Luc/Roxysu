import { Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { BeatmapCover } from "../../components/BeatmapCover";
import { BeatmapPreviewButton } from "../../components/BeatmapPreviewButton";
import { GoBackLink } from "../../components/GoBackLink";
import {
  ListSkeleton,
  PageHeaderSkeleton,
  PanelSkeleton,
  SkeletonBlock,
  StatGridSkeleton,
} from "../../components/LoadingSkeleton";
import { ModBadges } from "../../components/ModBadges";
import { PageTitle } from "../../components/PageTitle";
import { ScoreReplayButton } from "../../components/ScoreReplayButton";
import { fetchSession } from "../../lib/api";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
} from "../../lib/format";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { SessionSuggest } from "./SessionSuggest";
import { SessionTosuLivePanel } from "./SessionTosuLivePanel";
import { useAppDict, t } from "../../lib/i18n";

export function SessionDetailPage({ sessionId }: { sessionId: string }) {
  const ratingMode = useRatingDisplayMode();
  const { dict } = useAppDict();
  const isCurrentHub = sessionId === "current";

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["sessions", sessionId],
    queryFn: () => fetchSession(sessionId),
    enabled: Boolean(sessionId),
    placeholderData: keepPreviousData,
    // Historical sessions are immutable once closed; only the live "current"
    // hub needs to pick up SSE-driven invalidations immediately.
    staleTime: isCurrentHub ? 0 : 5 * 60_000,
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
    return (
      <div className="space-y-8">
        <div>
          <GoBackLink to="/sessions">
            {dict?.session.backToSessions}
          </GoBackLink>
          <div className="mt-3">
            <PageHeaderSkeleton
              subtitleWidth="w-72"
              actions={<SkeletonBlock className="h-7 w-20 rounded-full" />}
            />
          </div>
        </div>
        <StatGridSkeleton count={3} />
        <PanelSkeleton lines={3} />
        <section>
          <SkeletonBlock className="mb-3 h-8 w-24 rounded-lg" />
          <ListSkeleton count={6} />
        </section>
      </div>
    );
  }

  if (error || !data || !("session" in data)) {
    return (
      <div className="space-y-3">
        <GoBackLink to="/sessions">
          {dict?.session.backToSessions}
        </GoBackLink>
        <p className="text-rose-300">
          {error?.message ?? dict?.session.notFound}
        </p>
      </div>
    );
  }

  if ("error" in data) {
    return (
      <div className="space-y-3">
        <GoBackLink to="/sessions">
          {dict?.session.backToSessions}
        </GoBackLink>
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
          <GoBackLink to="/sessions">
            {dict?.session.backToSessions}
          </GoBackLink>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <PageTitle>{dict?.session.startASession}</PageTitle>
          </div>
          <p className="rx-subtitle">{dict?.session.startSessionSubtitle}</p>
        </div>

        <SessionTosuLivePanel />

        <SessionSuggest
          rulesetShortName={null}
          excludeBeatmapIds={[]}
        />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-3">
        <GoBackLink to="/sessions">
          {dict?.session.backToSessions}
        </GoBackLink>
        <p className="text-rose-300">{dict?.session.notFound}</p>
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
        <GoBackLink to="/sessions">
          {dict?.session.backToSessions}
        </GoBackLink>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <PageTitle>
            {isLive
              ? dict?.session.currentSession
              : t(dict?.session.sessionLabel, { id: session.id })}
          </PageTitle>
          {isLive ? (
            <span className="rx-chip bg-accent-glow text-accent">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              {dict?.session.liveChip}
              {isFetching ? (
                <span className="text-accent/70">
                  {dict?.session.updating}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <p className="rx-subtitle">
          {t(dict?.session.started, {
            time: formatRelativeTime(session.startedAt),
          })}
          {session.endedAt
            ? t(dict?.session.ended, {
                time: formatRelativeTime(session.endedAt),
              })
            : ""}
          {session.rulesetShortName ? ` · ${session.rulesetShortName}` : ""}
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <MiniStat
          label={dict?.session.statPlays ?? "Plays"}
          value={String(session.scoreCount)}
        />
        <MiniStat
          label={dict?.session.statPbs ?? "PBs"}
          value={String(data.pbCount ?? 0)}
        />
        <MiniStat
          label={dict?.session.statDuration ?? "Duration"}
          value={formatSessionDuration(session.startedAt, session.endedAt)}
        />
      </section>

      {isCurrentHub ? <SessionTosuLivePanel /> : null}

      {isCurrentHub ? (
        <SessionSuggest
          rulesetShortName={session.rulesetShortName}
          excludeBeatmapIds={excludeBeatmapIds}
        />
      ) : null}

      <section>
        <h2 className="mb-3 font-display text-2xl font-bold tracking-tight text-ink">
          {dict?.session.playsHeading}
        </h2>
        {scores.length === 0 ? (
          <p className="text-sm text-muted">
            {isLive
              ? dict?.session.noPlaysLive
              : dict?.session.noPlaysDone}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {scores.map((score) => {
              const isFresh = freshIds.has(score.id);
              const previewableRuleset =
                score.rulesetShortName === "mania" ||
                score.rulesetShortName === "osu";
              const canPreview =
                Boolean(score.beatmapId) && previewableRuleset;
              const canRewatch = score.hasReplay && previewableRuleset;
              const main = (
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
                        {score.title ?? dict?.session.untitled}
                      </span>
                      {score.isPb ? (
                        <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                          {dict?.session.pb}
                        </span>
                      ) : null}
                      {isFresh ? (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-accent">
                          {dict?.session.new}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-muted">
                      <span className="truncate">
                        {score.artist ?? dict?.session.unknownArtist}
                        {score.difficultyName ? ` · ${score.difficultyName}` : ""}
                        {" · "}
                        {formatPrimaryRating({
                          mode: ratingMode,
                          starRating: score.starRating,
                          sunnyEstDiff: score.sunnyEstDiff,
                          sunnyStar: score.sunnyStar,
                          danielEstDiff: score.danielEstDiff,
                          danielStar: score.danielStar,
                          keyCount: score.keyCount,
                        })}
                        {score.retryIndex != null && score.retryIndex > 0
                          ? t(dict?.session.retry, { n: score.retryIndex })
                          : ""}
                      </span>
                      <ModBadges mods={score.mods} />
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
                  <div className="rx-row gap-2">
                    {score.beatmapId ? (
                      <Link
                        to="/practice/$beatmapId"
                        params={{ beatmapId: score.beatmapId }}
                        className="flex min-w-0 flex-1 items-center gap-3"
                      >
                        {main}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {main}
                      </div>
                    )}
                    <div className="flex shrink-0 items-center gap-2">
                      {canPreview ? (
                        <BeatmapPreviewButton
                          beatmapId={score.beatmapId!}
                          className="rx-btn !px-2.5 !py-1 text-xs"
                        />
                      ) : null}
                      <ScoreReplayButton
                        scoreId={score.id}
                        enabled={canRewatch}
                        className="rx-btn !px-2.5 !py-1 text-xs"
                      />
                    </div>
                  </div>
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
