import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BeatmapCover } from "../../components/BeatmapCover";
import { GoBackLink } from "../../components/GoBackLink";
import {
  CardGridSkeleton,
  SkeletonBlock,
} from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { fetchCollectionResults } from "../../lib/api";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
} from "../../lib/format";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { useAppDict, t } from "../../lib/i18n";

const PAGE_SIZE = 24;

export function CollectionResultsPage({
  collectionId,
}: {
  collectionId: string;
}) {
  const { dict } = useAppDict();
  const ratingMode = useRatingDisplayMode();
  const id = Number(collectionId);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [collectionId]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["collections", id, "results", { page }],
    queryFn: () => fetchCollectionResults(id, { page, pageSize: PAGE_SIZE }),
    enabled: Number.isFinite(id),
  });

  const payload =
    data && "collection" in data && data.collection ? data : null;

  const totalPages =
    payload != null
      ? Math.max(1, Math.ceil(payload.total / (payload.pageSize ?? PAGE_SIZE)))
      : 1;

  function goToPage(next: number) {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <GoBackLink to="/collections">
            {dict?.collection.backToCollections}
          </GoBackLink>
          <div className="mt-3">
            <SkeletonBlock className="h-10 w-56 max-w-full rounded-xl" />
            <SkeletonBlock className="mt-3 h-4 w-full max-w-[28rem]" />
            <div className="mt-3 flex flex-wrap gap-3">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-10 w-36 rounded-xl" />
            </div>
          </div>
        </div>
        <CardGridSkeleton count={6} />
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="space-y-3">
        <GoBackLink to="/collections">
          {dict?.collection.backToCollections}
        </GoBackLink>
        <p className="text-rose-300">
          {error?.message ?? dict?.collection.notFound}
        </p>
      </div>
    );
  }

  const { collection, items, total } = payload;

  return (
    <div className="space-y-8">
      <div>
        <GoBackLink to="/collections">
          {dict?.collection.backToCollections}
        </GoBackLink>
        <PageTitle className="mt-3">{collection.name}</PageTitle>
        <p className="mt-2 font-mono text-sm text-muted">{collection.query}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-xs text-faint">
            {t(dict?.collection.matchesCount, {
              count: total.toLocaleString(),
            })}
          </p>
          {total > 0 && (
            <a
              href={`/api/collections/${collection.id}/export`}
              className="rx-btn"
              download
            >
              {dict?.collection.exportCollection}
            </a>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">{dict?.collection.noMatches}</p>
      ) : (
        <>
          <ul
            className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${isFetching ? "opacity-70" : ""}`}
          >
            {items.map((item, index) => (
              <li key={item.id}>
                <Link
                  to="/practice/$beatmapId"
                  params={{ beatmapId: item.id }}
                  className="rx-card"
                >
                  <BeatmapCover
                    backgroundFileHash={item.backgroundFileHash}
                    setOnlineId={item.setOnlineId}
                    size="card"
                    className="aspect-[2.2/1] w-full"
                    alt=""
                    priority={index < 6}
                  />
                  <div className="p-4">
                    <div className="truncate text-sm text-muted">
                      {item.artist}
                    </div>
                    <div className="truncate font-bold text-ink">
                      {item.title}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      [{item.difficultyName}] ·{" "}
                      {formatPrimaryRating({
                        mode: ratingMode,
                        starRating: item.starRating,
                        sunnyEstDiff: item.sunnyEstDiff,
                        sunnyStar: item.sunnyStar,
                        danielEstDiff: item.danielEstDiff,
                        danielStar: item.danielStar,
                        keyCount: item.keyCount,
                      })}
                    </div>
                    <div className="mt-2 flex gap-3 text-xs tabular-nums text-subtle">
                      <span>
                        {item.masteryLevel != null
                          ? item.masteryLevel.toFixed(0)
                          : "—"}{" "}
                        {dict?.collection.mastery}
                      </span>
                      <span>{formatAccuracy(item.bestAccuracy)}</span>
                      <span>{formatPp(item.bestPp)}</span>
                      <span>{formatRelativeTime(item.lastPlayedAt)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            <div className="flex flex-col items-center gap-2">
              <div className="text-sm text-muted">
                {t(dict?.practice.page, { page, total: totalPages })}
              </div>
              <div className="flex justify-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || isFetching}
                  onClick={() => goToPage(Math.max(1, page - 1))}
                  className="rx-btn"
                >
                  {dict?.practice.previous ?? "Previous"}
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages || isFetching}
                  onClick={() => goToPage(page + 1)}
                  className="rx-btn"
                >
                  {dict?.practice.next ?? "Next"}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
