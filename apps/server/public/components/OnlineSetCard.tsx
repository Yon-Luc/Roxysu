import type { ReactNode } from "react";
import { BeatmapCover } from "./BeatmapCover";
import { formatDurationSeconds } from "../lib/format";
import { osuWebBeatmapUrl } from "../lib/osuUrls";
import type { OnlineBeatmapSet } from "../lib/api";

/** Approximate osu! difficulty color bands, for small star-rating dots on cards. */
function starDotColor(stars: number): string {
  if (stars < 2) return "bg-lime-400";
  if (stars < 2.7) return "bg-sky-400";
  if (stars < 4) return "bg-amber-400";
  if (stars < 5.3) return "bg-pink-400";
  if (stars < 6.5) return "bg-violet-400";
  return "bg-rose-500";
}

function formatStars(stars: number): string {
  return `${stars.toFixed(2)}★`;
}

function difficultySummary(set: OnlineBeatmapSet): string {
  if (set.beatmaps.length === 0) return "No difficulties";
  const stars = set.beatmaps.map((b) => b.stars);
  const min = Math.min(...stars);
  const max = Math.max(...stars);
  const keys = [
    ...new Set(
      set.beatmaps
        .map((b) => b.keys)
        .filter((k): k is number => k != null && k > 0),
    ),
  ].sort((a, b) => a - b);
  const range =
    min === max ? formatStars(min) : `${formatStars(min)}–${formatStars(max)}`;
  const keyPart =
    keys.length > 0 ? ` · ${keys.map((k) => `${k}K`).join(", ")}` : "";
  return `${set.beatmaps.length} diff${set.beatmaps.length === 1 ? "" : "s"} · ${range}${keyPart}`;
}

export type OnlineSetCardProps = {
  set: OnlineBeatmapSet;
  /** Extra action buttons (e.g. Download). Website link is always shown. */
  actions?: ReactNode;
};

export function OnlineSetCard({ set, actions }: OnlineSetCardProps) {
  const firstDiff = set.beatmaps[0];
  const webUrl =
    (firstDiff ? osuWebBeatmapUrl(firstDiff.id, set.id) : null) ??
    `https://osu.ppy.sh/beatmapsets/${set.id}`;

  const diffDots = set.beatmaps.slice(0, 6);
  const extraDiffs = set.beatmaps.length - diffDots.length;
  const lengthLabel = formatDurationSeconds(set.lengthSeconds);

  return (
    <div className="rx-card flex h-full flex-col">
      <div className="relative">
        <BeatmapCover
          setOnlineId={set.id}
          size="card"
          className="aspect-[2.2/1] w-full"
          alt=""
        />
        {set.hasVideo ? (
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-ink backdrop-blur-sm">
            video
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="truncate text-sm text-muted">{set.artist}</div>
        <div className="truncate font-bold text-ink">{set.title}</div>
        <div className="mt-1 truncate text-xs text-muted">
          mapped by {set.creator}
          {" · "}
          {set.status}
          {set.bpm != null ? ` · ${Math.round(set.bpm)} BPM` : ""}
          {lengthLabel !== "—" ? ` · ${lengthLabel}` : ""}
        </div>

        {diffDots.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {diffDots.map((diff) => (
              <span
                key={diff.id}
                title={`[${diff.version}] ${formatStars(diff.stars)}`}
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${starDotColor(diff.stars)}`}
              />
            ))}
            {extraDiffs > 0 ? (
              <span className="text-xs text-faint">+{extraDiffs}</span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-1 truncate text-xs text-faint">
          {difficultySummary(set)}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <a href={webUrl} target="_blank" rel="noreferrer" className="rx-btn">
            Website
          </a>
          {actions}
        </div>
      </div>
    </div>
  );
}
