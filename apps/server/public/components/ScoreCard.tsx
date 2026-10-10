import type { ReactNode } from "react";
import { ModBadges } from "./ModBadges";
import { ScoreReplayButton } from "./ScoreReplayButton";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
} from "../lib/format";
import { useAppDict } from "../lib/i18n";

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

type ScoreCardProps = {
  score: ScoreCardScore;
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
    // Always show miss when any judgment exists; otherwise only non-zero.
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

export function ScoreCard({
  score,
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
  const hasIdentity = title != null || subtitle != null || badges != null;

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

          <div className="flex flex-wrap items-center gap-1.5 text-sm text-subtle">
            <span>{formatRelativeTime(score.playedAt, dict?.common)}</span>
            <ModBadges mods={score.mods} />
          </div>

          {score.judgments ? (
            <JudgmentStrip judgments={score.judgments} labels={labels} />
          ) : null}

          {footer}
        </div>

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
      </div>
    </li>
  );
}
