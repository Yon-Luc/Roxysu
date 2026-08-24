import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchSkillBandPlays, type SkillBandKind, type StatsSkillAxis } from "../../../lib/api";
import { ListSkeleton, SkeletonBlock } from "../../../components/LoadingSkeleton";
import {
  formatAccuracy,
  formatRelativeTime,
  formatStars,
} from "../../../lib/format";
import { type RatingDisplayMode } from "../../../lib/ratingDisplay";
import { useAppDict, t } from "../../../lib/i18n";
import { skillAxisLabel } from "../statsHelpers";
import type { Dictionary } from "@roxysu/i18n";

function SkillPlayList({
  title,
  plays,
  ratingMode,
  empty,
}: {
  title: string;
  plays: Array<{
    beatmapId: string;
    title: string;
    artist: string;
    difficultyName: string;
    accuracy: number;
    sunnyStar: number;
    danLabel: string;
    playedAt: string | number | null;
  }>;
  ratingMode: RatingDisplayMode;
  empty: string;
}) {
  const { dict } = useAppDict();
  return (
    <section>
      <h4 className="mb-2 text-sm font-bold text-ink">{title}</h4>
      {plays.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {plays.map((play) => (
            <li key={`${play.beatmapId}-${play.playedAt}`}>
              <Link
                to="/practice/$beatmapId"
                params={{ beatmapId: play.beatmapId }}
                className="rx-row gap-3 !py-2 hover:bg-elevated/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink">
                    {play.title}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-muted">
                    {play.artist}
                    {play.difficultyName ? ` · ${play.difficultyName}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <div className="font-semibold tabular-nums text-ink">
                    {formatAccuracy(play.accuracy)}
                  </div>
                  <div className="text-xs tabular-nums text-muted">
                    {ratingMode === "dan"
                      ? play.danLabel
                      : formatStars(play.sunnyStar)}
                    {" · "}
                    {play.playedAt != null
                      ? formatRelativeTime(String(play.playedAt), dict?.common)
                      : "—"}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SkillBandPlaysPanel({
  band,
  axis,
  topPlays,
  keyCount,
  ratingMode,
}: {
  band: SkillBandKind;
  axis: StatsSkillAxis;
  topPlays: number;
  keyCount: number;
  ratingMode: RatingDisplayMode;
}) {
  const { dict } = useAppDict();
  const { data, isLoading, error } = useQuery({
    queryKey: ["stats", "skill-plays", band, axis, topPlays, keyCount],
    queryFn: () =>
      fetchSkillBandPlays({
        band,
        axis: axis === "all" ? undefined : axis,
        topPlays,
        keyCount,
      }),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div id={`skill-band-${band}`} className="rx-panel p-4">
        <SkeletonBlock className="h-5 w-36" />
        <SkeletonBlock className="mt-2 h-3 w-64 max-w-full" />
        <div className="mt-5">
          <ListSkeleton count={4} showThumbnail={false} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div id={`skill-band-${band}`} className="rx-panel p-4">
        <p className="text-sm text-danger">
          {error?.message ?? dict?.stats.failedToLoadPlays ?? "Failed to load plays"}
        </p>
      </div>
    );
  }

  const axisLabel = skillAxisLabel(dict, axis);
  const bandTitle =
    band === "push"
      ? dict?.stats.bandPush ?? "Push"
      : band === "accuracy"
        ? dict?.stats.bandAccuracy ?? "Accuracy"
        : dict?.stats.bandConsistency ?? "Consistency";

  return (
    <div id={`skill-band-${band}`} className="rx-panel space-y-6 p-4 sm:p-5">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">
          {t(dict?.stats.bandPlays, { band: bandTitle })}
          {axis !== "all" ? ` · ${axisLabel}` : ""}
        </h3>
        <p className="mt-1 text-xs text-muted">
          {t(dict?.stats.topHardest, { count: topPlays })}
        </p>
      </div>

      <SkillPlayList
        title={t(dict?.stats.inBand, {
          count: data.inBandTotal,
          total: topPlays,
        })}
        plays={data.inBand}
        ratingMode={ratingMode}
        empty={dict?.stats.emptyBand ?? "No plays in this band yet."}
      />

      {data.nextDanLabel ? (
        <SkillPlayList
          title={t(dict?.stats.nextDan, {
            label: data.nextDanLabel,
            count: data.inNextDanTotal,
            total: topPlays,
          })}
          plays={data.inNextDan}
          ratingMode={ratingMode}
          empty={t(dict?.stats.noLabelClears, {
            label: data.nextDanLabel,
          })}
        />
      ) : (
        <p className="text-sm text-muted">
          {dict?.stats.noNextDan ??
            "No higher dan tier above your current estimate."}
        </p>
      )}
    </div>
  );
}
