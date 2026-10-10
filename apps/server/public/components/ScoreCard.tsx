import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BeatmapCover } from "./BeatmapCover";
import { ModBadges } from "./ModBadges";
import { ScoreReplayButton } from "./ScoreReplayButton";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
} from "../lib/format";
import { useAppDict, t } from "../lib/i18n";

export type ScoreJudgmentsView = {
  perfect: number;
  great: number;
  good: number;
  ok: number;
  meh: number;
  miss: number;
};

export type ScoreCardScore = {
  id: string;
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  mods: string | null;
  rank?: number | null;
  totalScore?: number | null;
  rulesetShortName: string | null;
  hasReplay: boolean;
  playedAt: string | null;
  judgments?: ScoreJudgmentsView | null;
};

export type ScoreCardBeatmap = {
  id: string | null;
  title?: string | null;
  artist?: string | null;
  difficultyName?: string | null;
  backgroundFileHash?: string | null;
  setOnlineId?: number | null;
  ratingLabel?: string | null;
  missing?: boolean;
};

export type ScoreCardPbCompare = {
  kind: "previous" | "current";
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  mods: string | null;
  playedAt: string | null;
};

type ScoreCardProps = {
  score: ScoreCardScore;
  variant?: "compact" | "beatmap";
  beatmap?: ScoreCardBeatmap;
  pbCompare?: ScoreCardPbCompare | null;
  /** Cover / map link for multi-map lists (sessions). */
  leading?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  footer?: ReactNode;
  /** Extra actions beside rewatch (e.g. Preview). */
  actions?: ReactNode;
  highlight?: boolean;
  className?: string;
};

const PREVIEWABLE = new Set(["mania", "osu", "taiko", "fruits"]);

const JUDGMENT_ORDER = [
  { key: "perfect", fallback: "Marvelous", color: "text-accent" },
  { key: "great", fallback: "Perfect", color: "text-warning" },
  { key: "good", fallback: "Great", color: "text-ink" },
  { key: "ok", fallback: "Good", color: "text-subtle" },
  { key: "meh", fallback: "Bad", color: "text-muted" },
  { key: "miss", fallback: "Miss", color: "text-danger" },
] as const;

function JudgmentStrip({
  judgments,
  labels,
}: {
  judgments: ScoreJudgmentsView;
  labels?: {
    perfect?: string;
    great?: string;
    good?: string;
    ok?: string;
    meh?: string;
    miss?: string;
  };
}) {
  const entries = JUDGMENT_ORDER.filter(
    ({ key }) => judgments[key] > 0 || key === "miss",
  ).filter(({ key }) => {
    if (key === "miss") {
      return (
        judgments.miss > 0 ||
        JUDGMENT_ORDER.some((j) => j.key !== "miss" && judgments[j.key] > 0)
      );
    }
    return judgments[key] > 0;
  });

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs tabular-nums">
      {entries.map(({ key, fallback, color }) => (
        <span key={key} className={color} title={labels?.[key] ?? fallback}>
          <span className="font-semibold">{judgments[key]}</span>
          <span className="ml-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
            {labels?.[key] ?? fallback}
          </span>
        </span>
      ))}
    </div>
  );
}

function formatSigned(value: number, suffix: string, digits: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${value.toFixed(digits)}${suffix}`;
}

function PbCompareFooter({
  score,
  compare,
}: {
  score: ScoreCardScore;
  compare: ScoreCardPbCompare;
}) {
  const { dict } = useAppDict();
  const label =
    compare.kind === "previous"
      ? (dict?.session.pbCompare?.previous ?? "Previous best")
      : (dict?.session.pbCompare?.current ?? "Current PB");

  const accDelta = (score.accuracy - compare.accuracy) * 100;
  const ppDelta =
    score.pp != null && compare.pp != null ? score.pp - compare.pp : null;

  const deltas: string[] = [];
  if (Number.isFinite(accDelta) && Math.abs(accDelta) >= 0.005) {
    deltas.push(formatSigned(accDelta, "%", 2));
  }
  if (ppDelta != null && Math.abs(ppDelta) >= 0.05) {
    deltas.push(formatSigned(ppDelta, "pp", 1));
  }

  return (
    <div className="rounded-lg bg-canvas/60 px-2.5 py-1.5 text-xs text-muted">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-semibold uppercase tracking-wide text-faint">
          {label}
        </span>
        <span className="tabular-nums text-subtle">
          {formatAccuracy(compare.accuracy)} · {formatPp(compare.pp)} ·{" "}
          {compare.maxCombo}x
        </span>
        <ModBadges mods={compare.mods} />
        <span className="text-faint">
          {formatRelativeTime(compare.playedAt, dict?.common)}
        </span>
      </div>
      {deltas.length > 0 ? (
        <p className="mt-0.5 tabular-nums text-accent/90">
          {t(dict?.session.pbCompare?.delta ?? "{{delta}}", {
            delta: deltas.join(" · "),
          })}
        </p>
      ) : null}
    </div>
  );
}

function BeatmapIdentity({
  beatmap,
  badges,
  meta,
}: {
  beatmap: ScoreCardBeatmap;
  badges?: ReactNode;
  meta?: ReactNode;
}) {
  const { dict } = useAppDict();
  const title = beatmap.missing
    ? (dict?.session.beatmapDeleted ?? "Beatmap deleted")
    : (beatmap.title ?? dict?.session.untitled ?? "Untitled");
  const subtitle = beatmap.missing
    ? (dict?.session.removedFromGame ?? "Removed from the game")
    : [
        beatmap.artist ?? dict?.session.unknownArtist ?? "Unknown",
        beatmap.difficultyName,
        beatmap.ratingLabel,
      ]
        .filter(Boolean)
        .join(" · ");

  const cover = (
    <BeatmapCover
      backgroundFileHash={beatmap.backgroundFileHash}
      setOnlineId={beatmap.setOnlineId}
      size="card"
      className="h-24 w-24 shrink-0 rounded-lg shadow-md shadow-black/40 sm:h-28 sm:w-28"
      alt=""
    />
  );

  const text = (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-semibold text-ink">{title}</span>
        {badges}
      </div>
      <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>
      {meta}
    </div>
  );

  if (beatmap.id && !beatmap.missing) {
    return (
      <Link
        to="/practice/$beatmapId"
        params={{ beatmapId: beatmap.id }}
        className="flex min-w-0 flex-1 items-start gap-3"
      >
        {cover}
        {text}
      </Link>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      {cover}
      {text}
    </div>
  );
}

export function ScoreCard({
  score,
  variant = "compact",
  beatmap,
  pbCompare,
  leading,
  title,
  subtitle,
  badges,
  footer,
  actions,
  highlight,
  className = "",
}: ScoreCardProps) {
  const { dict } = useAppDict();
  const labels = dict?.practice.detail.judgments;
  const canRewatch =
    score.hasReplay &&
    score.rulesetShortName != null &&
    PREVIEWABLE.has(score.rulesetShortName);
  const isBeatmap = variant === "beatmap" && beatmap != null;
  const hasIdentity =
    !isBeatmap && (title != null || subtitle != null || badges != null);

  const metrics = (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="text-right text-sm font-semibold tabular-nums text-ink">
        <div>{formatAccuracy(score.accuracy)}</div>
        <div className="text-xs font-medium text-muted">
          {formatPp(score.pp)} · {score.maxCombo}x
        </div>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <ScoreReplayButton
          scoreId={score.id}
          enabled={canRewatch}
          className="rx-btn !px-2.5 !py-1 text-xs font-semibold"
        />
      </div>
    </div>
  );

  const timeModsAndJudgments = (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-subtle">
        <span>{formatRelativeTime(score.playedAt, dict?.common)}</span>
        <ModBadges mods={score.mods} />
      </div>
      {score.judgments ? (
        <JudgmentStrip judgments={score.judgments} labels={labels} />
      ) : null}
    </div>
  );

  const compareFooter =
    footer ??
    (pbCompare ? <PbCompareFooter score={score} compare={pbCompare} /> : null);

  return (
    <li
      className={[
        "rx-panel list-none px-3 py-2.5 sm:px-4",
        highlight ? "bg-accent/10 transition-colors duration-1000" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isBeatmap ? (
        <div className="space-y-2.5">
          <div className="flex items-start gap-3">
            <BeatmapIdentity
              beatmap={beatmap}
              badges={badges}
              meta={timeModsAndJudgments}
            />
            {metrics}
          </div>
          {compareFooter}
        </div>
      ) : (
        <div className="flex items-start gap-3">
          {leading}
          <div className="min-w-0 flex-1 space-y-1.5">
            {hasIdentity ? (
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {title}
                  {badges}
                </div>
                {subtitle != null ? (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-muted">
                    {subtitle}
                  </div>
                ) : null}
              </div>
            ) : null}
            {timeModsAndJudgments}
            {compareFooter}
          </div>
          {metrics}
        </div>
      )}
    </li>
  );
}
