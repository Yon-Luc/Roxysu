import { BeatmapCover } from "../../components/BeatmapCover";
import { ModBadges } from "../../components/ModBadges";
import type { ScoreJudgmentsView } from "../../components/ScoreCard";
import { formatAccuracy, formatPp } from "../../lib/format";
import roxyIcon from "../../roxy.png";
import { formatSessionDuration } from "./sessionShareHighlights";

export type SessionSharePbCompare = {
  kind: "previous" | "current";
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  mods: string | null;
};

export type SessionShareCardScore = {
  id: string;
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  mods: string | null;
  isPb: boolean | null | undefined;
  title?: string | null;
  artist?: string | null;
  difficultyName?: string | null;
  backgroundFileHash?: string | null;
  setOnlineId?: number | null;
  beatmapId?: string | null;
  judgments?: ScoreJudgmentsView | null;
  pbCompare?: SessionSharePbCompare | null;
};

export type SessionShareCardLabels = {
  plays: string;
  pbs: string;
  duration: string;
  pb: string;
  untitled: string;
  unknownArtist: string;
  beatmapDeleted: string;
  morePlays: string;
  previousBest: string;
  currentPb: string;
  brand: string;
  judgments: {
    perfect?: string;
    great?: string;
    good?: string;
    ok?: string;
    meh?: string;
    miss?: string;
  };
};

export type SessionShareCardProps = {
  startedAt: string;
  endedAt: string | null;
  scoreCount: number;
  pbCount: number;
  highlights: SessionShareCardScore[];
  labels: SessionShareCardLabels;
};

/** Use two columns once the list would get tall; split evenly L/R. */
const TWO_COLUMN_MIN = 9;

const JUDGMENT_ORDER = [
  { key: "perfect", fallback: "Marvelous", color: "text-sky-300" },
  { key: "great", fallback: "Perfect", color: "text-amber-300" },
  { key: "good", fallback: "Great", color: "text-white/90" },
  { key: "ok", fallback: "Good", color: "text-white/65" },
  { key: "meh", fallback: "Bad", color: "text-white/45" },
  { key: "miss", fallback: "Miss", color: "text-rose-400" },
] as const;

function formatShareDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShareTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Absolute calendar range so the PNG stays meaningful later (never relative).
 * Same day → `Oct 12, 2026 · 09:14 – 10:02`. Different days → full datetime each side.
 */
function formatShareDateRange(
  startedAt: string,
  endedAt: string | null,
): string {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return "";
  const startDate = formatShareDate(startedAt);
  const startTime = formatShareTime(startedAt);
  if (!endedAt) {
    return startTime ? `${startDate} · ${startTime}` : startDate;
  }
  const end = new Date(endedAt);
  if (Number.isNaN(end.getTime())) {
    return startTime ? `${startDate} · ${startTime}` : startDate;
  }
  const endTime = formatShareTime(endedAt);
  if (sameLocalCalendarDay(start, end)) {
    return `${startDate} · ${startTime} – ${endTime}`;
  }
  const endDate = formatShareDate(endedAt);
  return `${startDate} · ${startTime} – ${endDate} · ${endTime}`;
}

function formatSigned(value: number, suffix: string, digits: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${value.toFixed(digits)}${suffix}`;
}

function ShareJudgmentStrip({
  judgments,
  labels,
}: {
  judgments: ScoreJudgmentsView;
  labels: SessionShareCardLabels["judgments"];
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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
      {entries.map(({ key, fallback, color }) => (
        <span key={key} className={color}>
          <span className="font-semibold">{judgments[key]}</span>
          <span className="ml-0.5 text-[9px] font-medium uppercase tracking-wide opacity-70">
            {labels[key] ?? fallback}
          </span>
        </span>
      ))}
    </div>
  );
}

function SharePbCompare({
  score,
  compare,
  labels,
}: {
  score: SessionShareCardScore;
  compare: SessionSharePbCompare;
  labels: SessionShareCardLabels;
}) {
  const label =
    compare.kind === "previous" ? labels.previousBest : labels.currentPb;
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
    <div className="mt-1.5 rounded-lg bg-black/25 px-2 py-1 text-[11px] text-white/55">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 whitespace-nowrap font-semibold uppercase tracking-wide text-white/35">
          {label}
        </span>
        <span className="tabular-nums text-white/70">
          {formatAccuracy(compare.accuracy)} · {formatPp(compare.pp)} ·{" "}
          {compare.maxCombo}x
        </span>
        <ModBadges mods={compare.mods} variant="overlay" />
      </div>
      {deltas.length > 0 ? (
        <p className="mt-0.5 tabular-nums text-sky-300/90">
          {deltas.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function ShareScoreRow({
  score,
  labels,
  className = "",
}: {
  score: SessionShareCardScore;
  labels: SessionShareCardLabels;
  className?: string;
}) {
  const missing = !score.beatmapId;
  const title = missing
    ? labels.beatmapDeleted
    : (score.title ?? labels.untitled);
  const artist = missing ? "" : (score.artist ?? labels.unknownArtist);
  const diff = missing ? null : score.difficultyName;

  return (
    <div
      className={`flex h-full flex-col rounded-xl border border-white/8 bg-white/5 px-3 py-2.5 ${className}`.trim()}
    >
      <div className="flex min-h-0 flex-1 items-start gap-3">
        <BeatmapCover
          backgroundFileHash={score.backgroundFileHash}
          setOnlineId={score.setOnlineId}
          size="list"
          priority
          className="size-12 shrink-0 rounded-lg"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{title}</p>
            {score.isPb ? (
              <span className="shrink-0 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                {labels.pb}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-white/50">
            {[artist, diff].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <ModBadges mods={score.mods} variant="overlay" />
            {score.judgments ? (
              <ShareJudgmentStrip
                judgments={score.judgments}
                labels={labels.judgments}
              />
            ) : null}
          </div>
          {score.pbCompare ? (
            <SharePbCompare
              score={score}
              compare={score.pbCompare}
              labels={labels}
            />
          ) : (
            <div className="min-h-0 flex-1" aria-hidden />
          )}
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <div className="text-sm font-semibold text-white">
            {formatAccuracy(score.accuracy)}
          </div>
          <div className="text-xs text-white/50">{formatPp(score.pp)}</div>
          <div className="text-[11px] text-white/40">{score.maxCombo}x</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Fixed dark session share card for PNG capture (chat paste).
 * Always dark — does not follow `html.light`.
 * Many scores → wider two-column layout (even split) instead of a taller card.
 */
export function SessionShareCard({
  startedAt,
  endedAt,
  scoreCount,
  pbCount,
  highlights,
  labels,
}: SessionShareCardProps) {
  const remaining = Math.max(0, scoreCount - highlights.length);
  const dateRange = formatShareDateRange(startedAt, endedAt);
  const twoColumns = highlights.length >= TWO_COLUMN_MIN;
  const mid = Math.ceil(highlights.length / 2);
  const leftScores = twoColumns ? highlights.slice(0, mid) : highlights;
  const rightScores = twoColumns ? highlights.slice(mid) : [];

  return (
    <div
      data-session-share-card
      className={`box-border overflow-hidden rounded-2xl border border-white/10 bg-[#12141a] p-6 text-white shadow-2xl ${
        twoColumns ? "w-[1440px]" : "w-[720px]"
      }`}
      style={{ fontFamily: "Figtree, system-ui, sans-serif" }}
    >
      <header className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={roxyIcon}
            alt=""
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-full object-cover"
          />
          <h1
            className="min-w-0 text-[1.65rem] leading-tight font-bold tracking-tight text-white"
            style={{ fontFamily: "Outfit, Figtree, system-ui, sans-serif" }}
          >
            {dateRange || "Session"}
          </h1>
        </div>
        <div className="shrink-0 text-right text-xs font-semibold uppercase tracking-wider text-white/40">
          {labels.brand}
        </div>
      </header>

      <div
        className={`mt-5 grid grid-cols-3 gap-3 ${
          twoColumns ? "mx-auto w-full max-w-[720px]" : ""
        }`}
      >
        <ShareStat label={labels.plays} value={String(scoreCount)} />
        <ShareStat label={labels.pbs} value={String(pbCount)} />
        <ShareStat
          label={labels.duration}
          value={formatSessionDuration(startedAt, endedAt)}
        />
      </div>

      {highlights.length > 0 ? (
        twoColumns ? (
          <div className="mt-5 flex flex-col gap-2.5">
            {Array.from(
              { length: Math.max(leftScores.length, rightScores.length) },
              (_, i) => {
                const left = leftScores[i];
                const right = rightScores[i];
                return (
                  <div
                    key={`${left?.id ?? "empty"}-${right?.id ?? "empty"}`}
                    className="grid grid-cols-2 items-stretch gap-3"
                  >
                    {left ? (
                      <ShareScoreRow score={left} labels={labels} />
                    ) : (
                      <div />
                    )}
                    {right ? (
                      <ShareScoreRow score={right} labels={labels} />
                    ) : (
                      <div />
                    )}
                  </div>
                );
              },
            )}
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-2.5">
            {leftScores.map((score) => (
              <ShareScoreRow key={score.id} score={score} labels={labels} />
            ))}
          </div>
        )
      ) : null}

      {remaining > 0 ? (
        <p className="mt-4 text-center text-xs text-white/40">
          {labels.morePlays.replace("{{count}}", String(remaining))}
        </p>
      ) : null}
    </div>
  );
}

function ShareStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums text-white">
        {value}
      </div>
    </div>
  );
}
