import { BeatmapCover } from "../../components/BeatmapCover";
import { ModBadges } from "../../components/ModBadges";
import { formatAccuracy, formatPp } from "../../lib/format";
import roxyIcon from "../../roxy.png";
import { formatSessionDuration } from "./sessionShareHighlights";

export type SessionShareCardScore = {
  id: string;
  accuracy: number;
  pp: number | null;
  mods: string | null;
  isPb: boolean | null | undefined;
  title?: string | null;
  artist?: string | null;
  difficultyName?: string | null;
  backgroundFileHash?: string | null;
  setOnlineId?: number | null;
  beatmapId?: string | null;
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
  brand: string;
};

export type SessionShareCardProps = {
  rulesetShortName: string | null;
  startedAt: string;
  endedAt: string | null;
  scoreCount: number;
  pbCount: number;
  highlights: SessionShareCardScore[];
  labels: SessionShareCardLabels;
};

function formatShareDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Absolute calendar range so the PNG stays meaningful later (never relative). */
function formatShareDateRange(
  startedAt: string,
  endedAt: string | null,
): string {
  const startLabel = formatShareDateTime(startedAt);
  if (!startLabel) return "";
  if (!endedAt) return startLabel;
  const endLabel = formatShareDateTime(endedAt);
  if (!endLabel) return startLabel;
  return `${startLabel} – ${endLabel}`;
}

/**
 * Fixed dark session share card for PNG capture (chat paste).
 * Always dark — does not follow `html.light`.
 */
export function SessionShareCard({
  rulesetShortName,
  startedAt,
  endedAt,
  scoreCount,
  pbCount,
  highlights,
  labels,
}: SessionShareCardProps) {
  const remaining = Math.max(0, scoreCount - highlights.length);
  const dateRange = formatShareDateRange(startedAt, endedAt);

  return (
    <div
      data-session-share-card
      className="box-border w-[720px] overflow-hidden rounded-2xl border border-white/10 bg-[#12141a] p-6 text-white shadow-2xl"
      style={{ fontFamily: "Figtree, system-ui, sans-serif" }}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={roxyIcon}
            alt=""
            width={56}
            height={56}
            className="size-14 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0">
            <h1
              className="text-xl font-bold tracking-tight text-white sm:text-2xl"
              style={{ fontFamily: "Outfit, Figtree, system-ui, sans-serif" }}
            >
              {dateRange || "Session"}
            </h1>
            {rulesetShortName ? (
              <p className="mt-0.5 text-sm text-white/55">{rulesetShortName}</p>
            ) : null}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs font-semibold uppercase tracking-wider text-white/40">
          {labels.brand}
        </div>
      </header>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <ShareStat label={labels.plays} value={String(scoreCount)} />
        <ShareStat label={labels.pbs} value={String(pbCount)} />
        <ShareStat
          label={labels.duration}
          value={formatSessionDuration(startedAt, endedAt)}
        />
      </div>

      {highlights.length > 0 ? (
        <ul className="mt-5 space-y-2">
          {highlights.map((score) => {
            const missing = !score.beatmapId;
            const title = missing
              ? labels.beatmapDeleted
              : (score.title ?? labels.untitled);
            const artist = missing
              ? ""
              : (score.artist ?? labels.unknownArtist);
            const diff = missing ? null : score.difficultyName;

            return (
              <li
                key={score.id}
                className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/5 px-3 py-2.5"
              >
                <BeatmapCover
                  backgroundFileHash={score.backgroundFileHash}
                  setOnlineId={score.setOnlineId}
                  size="list"
                  priority
                  className="size-12 shrink-0 rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-white">
                      {title}
                    </p>
                    {score.isPb ? (
                      <span className="shrink-0 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                        {labels.pb}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-white/50">
                    {[artist, diff].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-1">
                    <ModBadges mods={score.mods} variant="overlay" />
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="text-sm font-semibold text-white">
                    {formatAccuracy(score.accuracy)}
                  </div>
                  <div className="text-xs text-white/50">
                    {formatPp(score.pp)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
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
