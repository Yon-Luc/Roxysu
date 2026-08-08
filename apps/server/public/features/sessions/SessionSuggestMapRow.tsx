import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BeatmapCover } from "../../components/BeatmapCover";
import { BeatmapPreviewButton } from "../../components/BeatmapPreviewButton";
import { CopyBeatmapSearchButton } from "../../components/CopyBeatmapSearchButton";
import { formatAccuracy, formatRelativeTime } from "../../lib/format";
import { osuClientBeatmapUrl } from "../../lib/osuUrls";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { useAppDict } from "../../lib/i18n";

export type SessionSuggestMapFields = {
  id: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  starRating: number;
  sunnyEstDiff?: string | null;
  sunnyStar?: number | null;
  danielEstDiff?: string | null;
  danielStar?: number | null;
  keyCount?: number | null;
  backgroundFileHash: string | null;
  setOnlineId: number | null;
  onlineId: number | null;
  bestAccuracy: number | null;
  lastPlayedAt: string | null | undefined;
};

export function SessionSuggestMapRow({
  item,
  metaExtra,
  subtitle,
}: {
  item: SessionSuggestMapFields;
  /** Extra content appended to the title/artist/rating line (e.g. % vs skill). */
  metaExtra?: ReactNode;
  /** Optional second line under the meta row (e.g. reasoning). */
  subtitle?: ReactNode;
}) {
  const ratingMode = useRatingDisplayMode();
  const { dict } = useAppDict();
  const clientUrl = osuClientBeatmapUrl(item.onlineId);

  return (
    <li className="rx-row">
      <Link
        to="/practice/$beatmapId"
        params={{ beatmapId: item.id }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <BeatmapCover
          backgroundFileHash={item.backgroundFileHash}
          setOnlineId={item.setOnlineId}
          size="list"
          className="h-12 w-12 shrink-0 rounded shadow-md shadow-black/40"
          alt=""
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-ink">
            {item.title ?? dict?.session.untitled}
          </div>
          <div className="mt-0.5 truncate text-sm text-muted">
            {item.artist ?? dict?.session.unknownArtist}
            {item.difficultyName ? ` · ${item.difficultyName}` : ""}
            {" · "}
            {formatPrimaryRating({
              mode: ratingMode,
              starRating: item.starRating,
              sunnyEstDiff: item.sunnyEstDiff,
              sunnyStar: item.sunnyStar,
              danielEstDiff: item.danielEstDiff,
              danielStar: item.danielStar,
              keyCount: item.keyCount,
            })}
            {metaExtra}
          </div>
          {subtitle != null ? (
            <div className="mt-0.5 truncate text-xs text-faint">{subtitle}</div>
          ) : null}
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <div className="font-semibold tabular-nums text-ink">
            {item.bestAccuracy != null
              ? formatAccuracy(item.bestAccuracy)
              : "—"}
          </div>
          <div className="text-xs tabular-nums text-muted">
            {item.lastPlayedAt
              ? formatRelativeTime(item.lastPlayedAt)
              : dict?.session.neverPlayed}
          </div>
        </div>
      </Link>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <BeatmapPreviewButton beatmapId={item.id} />
        <CopyBeatmapSearchButton
          title={item.title}
          difficultyName={item.difficultyName}
          className="rx-btn"
        />
        {clientUrl ? (
          <a href={clientUrl} className="rx-btn">
            {dict?.session.openInOsu}
          </a>
        ) : null}
      </div>
    </li>
  );
}
