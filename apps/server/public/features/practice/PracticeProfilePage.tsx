import { Link, useCanGoBack } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { BeatmapCover } from "../../components/BeatmapCover";
import { BeatmapPreviewButton } from "../../components/BeatmapPreviewButton";
import { CopyBeatmapSearchButton } from "../../components/CopyBeatmapSearchButton";
import { GoBackLink } from "../../components/GoBackLink";
import {
  HeroSkeleton,
  ListSkeleton,
  PanelSkeleton,
  SkeletonBlock,
  StatGridSkeleton,
} from "../../components/LoadingSkeleton";
import {
  ManiaPatternDetailPanel,
  formatPatternLabel,
  type ManiaPatternDetailView,
} from "../../components/mania-analysis";
import {
  ScoreCard,
  type ScoreCardScore,
} from "../../components/ScoreCard";
import { fetchBeatmap } from "../../lib/api";
import {
  formatAccuracy,
  formatRelativeTime,
} from "../../lib/format";
import {
  osuClientBeatmapUrl,
  osuWebBeatmapUrl,
} from "../../lib/osuUrls";
import {
  formatPrimaryRating,
  primaryDanSource,
  primaryDanStar,
  primaryRatingDisplayTitle,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { useAppDict, t } from "../../lib/i18n";
import roxyIcon from "../../roxy.png";

function MapBackLink() {
  const canGoBack = useCanGoBack();
  const { dict } = useAppDict();
  return (
    <GoBackLink to="/practice" history>
      {canGoBack
        ? (dict?.practice.detail.back ?? "Back")
        : (dict?.practice.detail.backToPractice ?? "Practice")}
    </GoBackLink>
  );
}

function MapMoreActions({
  beatmapId,
  webUrl,
}: {
  beatmapId: string;
  webUrl: string | null;
}) {
  const { dict } = useAppDict();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="rx-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {dict?.practice.detail.moreActions ?? "More"}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 min-w-[11rem] overflow-hidden rounded-xl bg-elevated py-1 shadow-lg shadow-black/40 ring-1 ring-white/10"
        >
          <a
            role="menuitem"
            href={`/api/beatmaps/${beatmapId}/export`}
            className="block px-3 py-2 text-sm font-semibold text-ink hover:bg-highlight"
            download
            onClick={() => setOpen(false)}
          >
            {dict?.practice.detail.exportMap}
          </a>
          <a
            role="menuitem"
            href={`/api/beatmaps/${beatmapId}/export-set`}
            className="block px-3 py-2 text-sm font-semibold text-ink hover:bg-highlight"
            download
            onClick={() => setOpen(false)}
          >
            {dict?.practice.detail.exportSet}
          </a>
          {webUrl ? (
            <a
              role="menuitem"
              href={webUrl}
              target="_blank"
              rel="noreferrer"
              className="block px-3 py-2 text-sm font-semibold text-ink hover:bg-highlight"
              onClick={() => setOpen(false)}
            >
              {dict?.practice.detail.viewOnWebsite}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PracticeProfilePage({ beatmapId }: { beatmapId: string }) {
  const { dict } = useAppDict();
  const ratingMode = useRatingDisplayMode();
  const { data, isLoading, error } = useQuery({
    queryKey: ["beatmap", beatmapId],
    queryFn: () => fetchBeatmap(beatmapId),
    enabled: Boolean(beatmapId),
  });
  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <MapBackLink />
          <HeroSkeleton />
        </div>
        <StatGridSkeleton />
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={3} />
          <PanelSkeleton lines={3} />
        </section>
        <PanelSkeleton lines={1} className="min-h-[20rem]" />
        <section>
          <SkeletonBlock className="mb-3 h-8 w-40 rounded-lg" />
          <ListSkeleton count={6} showThumbnail={false} />
        </section>
      </div>
    );
  }

  if (error || !data || !("beatmap" in data) || !data.beatmap) {
    return (
      <div className="space-y-3">
        <MapBackLink />
        <p className="text-danger">
          {error?.message ?? dict?.practice.detail.notFound}
        </p>
      </div>
    );
  }

  const beatmap = data.beatmap;
  const stats = data.stats!;
  const recentScores = data.recentScores ?? [];
  const sunnyDan =
    data && "sunnyDan" in data
      ? (data as { sunnyDan?: {
          estDiff: string | null;
          sunnyStar: number | null;
          columnCount: number | null;
          lnRatio: number | null;
          error: string | null;
        } | null }).sunnyDan
      : null;
  const danielDan =
    data && "danielDan" in data
      ? (data as { danielDan?: {
          estDiff: string | null;
          danielStar: number | null;
          columnCount: number | null;
          lnRatio: number | null;
          numericDifficulty: number | null;
          error: string | null;
        } | null }).danielDan
      : null;
  const reworkDan =
    data && "reworkDan" in data
      ? (data as { reworkDan?: {
          estDiff: string | null;
          reworkStar: number | null;
          columnCount: number | null;
          lnRatio: number | null;
          error: string | null;
        } | null }).reworkDan
      : null;
  const keyCount =
    beatmap.circleSize != null ? Math.round(beatmap.circleSize) : null;
  const ratingLabels = {
    danielDan: dict?.practice.detail.danielDan ?? "Daniel dan",
    sunnyDan: dict?.practice.detail.sunnyDan ?? "Sunny dan",
    danielStar:
      dict?.settings.ratingDisplay.dan?.labelDanielStar ?? "Daniel star rating",
    sunnyStar: dict?.settings.ratingDisplay.sunny?.label ?? "Sunny star rating",
    reworkDan:
      dict?.settings.ratingDisplay.rework?.labelReworkDan ?? "Rework dan",
    reworkStar:
      dict?.settings.ratingDisplay.rework?.labelReworkStar ??
      "Rework star rating",
  };
  const primarySource = primaryDanSource({
    mode: ratingMode,
    keyCount,
    danielEstDiff: danielDan?.estDiff,
    danielStar: danielDan?.danielStar,
    sunnyEstDiff: sunnyDan?.estDiff,
    sunnyStar: sunnyDan?.sunnyStar,
    reworkEstDiff: reworkDan?.estDiff,
    reworkStar: reworkDan?.reworkStar,
  });
  const primaryTitle = primaryRatingDisplayTitle(
    ratingMode,
    primarySource,
    ratingLabels,
  );
  const primaryStar = primaryDanStar({
    mode: ratingMode,
    keyCount,
    danielStar: danielDan?.danielStar,
    sunnyStar: sunnyDan?.sunnyStar,
    reworkStar: reworkDan?.reworkStar,
  });
  const patternAnalysis =
    data && "patternAnalysis" in data
      ? (data as { patternAnalysis?: {
          algorithm: string;
          dominantPattern: string | null;
          secondaryPattern: string | null;
          confidence: number | null;
          jackDensity: number | null;
          chordDensity: number | null;
          streamDensity: number | null;
          bracketDensity: number | null;
          chordjackScore: number | null;
          jumpstreamScore: number | null;
          chordstreamScore: number | null;
          error: string | null;
        } | null }).patternAnalysis
      : null;
  const sevenKAnalysis =
    data && "sevenKAnalysis" in data
      ? (data as { sevenKAnalysis?: ManiaPatternDetailView | null })
          .sevenKAnalysis
      : null;
  const sessions = data.sessions ?? [];
  const clientUrl = osuClientBeatmapUrl(beatmap.onlineId);
  const webUrl = osuWebBeatmapUrl(beatmap.onlineId, beatmap.setOnlineId);
  const displayedRating = formatPrimaryRating({
    mode: ratingMode,
    starRating: beatmap.starRating,
    sunnyEstDiff: sunnyDan?.estDiff,
    sunnyStar: sunnyDan?.sunnyStar,
    danielEstDiff: danielDan?.estDiff,
    danielStar: danielDan?.danielStar,
    reworkEstDiff: reworkDan?.estDiff,
    reworkStar: reworkDan?.reworkStar,
    lnRatio: reworkDan?.lnRatio,
    keyCount,
  });

  return (
    <div className="space-y-8">
      <div>
        <MapBackLink />
        <div className="relative mt-4 overflow-hidden rounded-xl">
          <BeatmapCover
            backgroundFileHash={beatmap.backgroundFileHash}
            setOnlineId={beatmap.setOnlineId}
            size="cover"
            priority
            className="aspect-[21/9] w-full max-h-64 sm:max-h-72"
            alt=""
          />
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <p className="text-sm font-medium text-subtle">
              {beatmap.artist}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <img
                src={roxyIcon}
                alt=""
                className="size-14 shrink-0 rounded-full object-cover sm:size-16"
              />
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                {beatmap.title}
              </h1>
            </div>
            <p className="mt-2 text-sm text-muted">
              [{beatmap.difficultyName}] · {displayedRating}{" "}
              · {beatmap.bpm.toFixed(0)} BPM
              {beatmap.mapperUsername
                ? t(dict?.practice.detail.mappedBy, {
                    mapper: beatmap.mapperUsername,
                  })
                : ""}
              {ratingMode === "osu" && sunnyDan?.estDiff
                ? t(dict?.practice.detail.sunny, {
                    stars: sunnyDan.estDiff,
                  })
                : ""}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <BeatmapPreviewButton beatmapId={beatmap.id} />
              {clientUrl && (
                <a href={clientUrl} className="rx-btn-primary">
                  {dict?.practice.detail.openInOsu}
                </a>
              )}
              <CopyBeatmapSearchButton
                title={beatmap.title}
                difficultyName={beatmap.difficultyName}
              />
              <MapMoreActions beatmapId={beatmap.id} webUrl={webUrl} />
            </div>
          </div>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <MiniStat
          label={dict?.practice.detail.statPlays}
          value={String(stats.playCount)}
        />
        <MiniStat
          label={dict?.practice.detail.statBestAcc}
          value={formatAccuracy(stats.bestAccuracy)}
        />
        <MiniStat
          label={dict?.practice.detail.statLastPlayed}
          value={formatRelativeTime(stats.lastPlayedAt, dict?.common)}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {beatmap.rulesetShortName === "mania" &&
        (ratingMode === "dan" ||
          ratingMode === "sunny" ||
          ratingMode === "rework") ? (
          <div className="rx-panel px-5 py-5">
            <h3 className="text-sm font-bold text-ink">
              {primaryTitle ??
                (ratingMode === "sunny"
                  ? ratingLabels.sunnyStar
                  : ratingMode === "rework"
                    ? ratingLabels.reworkDan
                    : ratingLabels.sunnyDan)}
            </h3>
            {displayedRating !== "—" ? (
              <div className="mt-3 space-y-1">
                <div className="font-display text-2xl font-extrabold text-accent">
                  {displayedRating}
                </div>
                {primaryStar != null ? (
                  <p className="text-xs text-muted">
                    {t(dict?.practice.detail.reworkStars, {
                      stars: primaryStar.toFixed(2),
                    })}
                    {keyCount != null
                      ? t(dict?.practice.detail.columnK, { count: keyCount })
                      : ""}
                    {primarySource === "sunny" && sunnyDan?.lnRatio != null
                      ? t(dict?.practice.detail.lnRatio, {
                          pct: (sunnyDan.lnRatio * 100).toFixed(0),
                        })
                      : ""}
                    {primarySource === "rework" && reworkDan?.lnRatio != null
                      ? t(dict?.practice.detail.lnRatio, {
                          pct: (reworkDan.lnRatio * 100).toFixed(0),
                        })
                      : ""}
                  </p>
                ) : (
                  <p className="text-xs text-muted">
                    {dict?.practice.detail.notAvailable}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-faint">
                {reworkDan?.error ??
                  danielDan?.error ??
                  sunnyDan?.error ??
                  dict?.practice.detail.notAvailable}
              </p>
            )}
          </div>
        ) : null}
        {beatmap.rulesetShortName === "mania" && ratingMode === "osu" && (
          <div className="rx-panel px-5 py-5">
            <h3 className="text-sm font-bold text-ink">
              {dict?.practice.detail.sunnyDan}
            </h3>
            {sunnyDan?.estDiff ? (
              <div className="mt-3 space-y-1">
                <div className="font-display text-2xl font-extrabold text-accent">
                  {sunnyDan.estDiff}
                </div>
                <p className="text-xs text-muted">
                  {sunnyDan.sunnyStar != null
                    ? t(dict?.practice.detail.reworkStars, {
                        stars: sunnyDan.sunnyStar.toFixed(2),
                      })
                    : dict?.practice.detail.rework}
                  {sunnyDan.columnCount != null
                    ? t(dict?.practice.detail.columnK, {
                        count: sunnyDan.columnCount,
                      })
                    : ""}
                  {sunnyDan.lnRatio != null
                    ? t(dict?.practice.detail.lnRatio, {
                        pct: (sunnyDan.lnRatio * 100).toFixed(0),
                      })
                    : ""}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-faint">
                {sunnyDan?.error ?? dict?.practice.detail.notAvailable}
              </p>
            )}
          </div>
        )}
        {keyCount === 4 && ratingMode === "osu" && (
          <div className="rx-panel px-5 py-5">
            <h3 className="text-sm font-bold text-ink">
              {dict?.practice.detail.danielDan ?? "Daniel dan"}
            </h3>
            {danielDan?.estDiff ? (
              <div className="mt-3 space-y-1">
                <div className="font-display text-2xl font-extrabold text-accent">
                  {danielDan.estDiff}
                </div>
                <p className="text-xs text-muted">
                  {danielDan.danielStar != null
                    ? t(dict?.practice.detail.reworkStars, {
                        stars: danielDan.danielStar.toFixed(2),
                      })
                    : dict?.practice.detail.rework}
                  {danielDan.numericDifficulty != null
                    ? ` · #${danielDan.numericDifficulty.toFixed(2)}`
                    : ""}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-faint">
                {danielDan?.error ?? dict?.practice.detail.notAvailable}
              </p>
            )}
          </div>
        )}
        {patternAnalysis != null && (
          <div className="rx-panel px-5 py-5">
            <h3 className="text-sm font-bold text-ink">
              {dict?.practice.detail.pattern}
            </h3>
            {patternAnalysis.dominantPattern ? (
              <div className="mt-3 space-y-1">
                <div className="font-display text-2xl font-extrabold text-accent">
                  {formatPatternLabel(
                    patternAnalysis.dominantPattern,
                    dict?.practice.detail.patterns,
                  )}
                </div>
                <p className="text-xs text-muted">
                  {patternAnalysis.secondaryPattern
                    ? t(dict?.practice.detail.patternPlus, {
                        pattern: formatPatternLabel(
                          patternAnalysis.secondaryPattern,
                          dict?.practice.detail.patterns,
                        ),
                      })
                    : null}
                  {patternAnalysis.confidence != null
                    ? t(dict?.practice.detail.confidencePct, {
                        pct: Math.round(patternAnalysis.confidence * 100),
                      })
                    : null}
                </p>
                <PatternDensityHints pattern={patternAnalysis} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-faint">
                {patternAnalysis.error ?? dict?.practice.detail.notAvailable}
              </p>
            )}
          </div>
        )}
        <div className="rx-panel px-5 py-5">
          <h3 className="text-sm font-bold text-ink">
            {dict?.practice.detail.sessions}
          </h3>
          {sessions.length === 0 ? (
            <p className="mt-3 text-sm text-faint">
              {dict?.practice.detail.noSessionsLinked}
            </p>
          ) : (
            <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/sessions/$sessionId"
                    params={{
                      sessionId:
                        s.endedAt == null ? "current" : String(s.id),
                    }}
                    className="rx-row justify-between !px-2 !py-1.5 text-sm"
                  >
                    <span className="text-subtle">
                      {formatRelativeTime(s.startedAt, dict?.common)}
                    </span>
                    <span className="tabular-nums text-muted">
                      {t(dict?.practice.detail.plays, {
                        count: s.scoreCount,
                      })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {beatmap.rulesetShortName === "mania" && sevenKAnalysis != null ? (
        <section className="rx-panel p-5 sm:p-6">
          <ManiaPatternDetailPanel
            beatmapLengthMs={beatmap.length ?? null}
            keyCount={
              beatmap.circleSize != null ? Math.round(beatmap.circleSize) : null
            }
            bpm={beatmap.bpm ?? null}
            analysis={sevenKAnalysis}
          />
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 font-display text-2xl font-bold tracking-tight text-ink">
          {dict?.practice.detail.scoreTimeline}
        </h2>
        {recentScores.length === 0 ? (
          <p className="text-sm text-muted">
            {dict?.practice.detail.noScoresOnMap}
          </p>
        ) : (
          <ul className="space-y-2">
            {recentScores.map((score) => (
              <ScoreCard
                key={score.id}
                score={{
                  id: score.id,
                  accuracy: score.accuracy,
                  pp: score.pp,
                  maxCombo: score.maxCombo,
                  mods: score.mods,
                  rank: score.rank,
                  totalScore: score.totalScore,
                  rulesetShortName: score.rulesetShortName,
                  hasReplay: score.hasReplay,
                  playedAt: score.playedAt,
                  judgments:
                    "judgments" in score
                      ? (score.judgments as ScoreCardScore["judgments"])
                      : null,
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MiniStat({ label, value }: { label?: string; value: string }) {
  return (
    <div className="rx-stat">
      <div className="rx-label">{label}</div>
      <div className="mt-1.5 text-lg font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function PatternDensityHints({
  pattern,
}: {
  pattern: {
    dominantPattern: string | null;
    jackDensity: number | null;
    chordDensity: number | null;
    streamDensity: number | null;
    bracketDensity: number | null;
  };
}) {
  const { dict } = useAppDict();
  const hintWords = dict?.practice.detail.hintWords as
    | Record<string, string>
    | undefined;
  const hints: string[] = [];
  const dominant = pattern.dominantPattern;
  const fallback: Record<string, string> = {
    jack: "jack",
    chord: "chord",
    delay: "delay",
    bracket: "bracket",
  };

  const add = (label: string, value: number | null, key: string) => {
    if (value == null || value < 0.08 || key === dominant) return;
    hints.push(`${hintWords?.[label] ?? fallback[label]} ${Math.round(value * 100)}%`);
  };

  add("jack", pattern.jackDensity, "jack");
  add("chord", pattern.chordDensity, "chordjack");
  add("delay", pattern.streamDensity, "delay");
  add("bracket", pattern.bracketDensity, "bracket");

  if (hints.length === 0) return null;

  return <p className="text-xs text-faint">{hints.join(" · ")}</p>;
}

