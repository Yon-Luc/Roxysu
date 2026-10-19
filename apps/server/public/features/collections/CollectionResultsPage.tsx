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

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-faint">
        {label}
      </div>
      <div className="mt-0.5 truncate tabular-nums text-subtle">{value}</div>
    </div>
  );
}

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
    // Page changes keep the previous page on screen (header, count, grid).
    // Another collection's payload must never stand in for this one.
    placeholderData: (previous) =>
      previous && "collection" in previous && previous.collection?.id === id
        ? previous
        : undefined,
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

  if (isLoading && !payload) {
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
        <p className="text-danger">
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
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <PageTitle>{collection.name}</PageTitle>
            <p className="mt-2 truncate font-mono text-sm text-muted">
              {collection.query}
            </p>
            <p className="mt-1 text-xs text-faint">
              {t(dict?.collection.matchesCount, {
                count: total.toLocaleString(),
              })}
            </p>
          </div>
          {total > 0 ? (
            <a
              href={`/api/collections/${collection.id}/export`}
              className="rx-btn shrink-0"
              download
            >
              {dict?.collection.exportCollection}
            </a>
          ) : null}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">{dict?.collection.noMatches}</p>
      ) : (
        <>
          <ul
            className={`grid gap-4 transition-opacity duration-150 sm:grid-cols-2 lg:grid-cols-3 ${isFetching ? "opacity-70" : ""}`}
            aria-busy={isFetching}
          >
            {items.map((item, index) => (
              <li key={item.id}>
                <Link
                  to="/practice/$beatmapId"
                  params={{ beatmapId: item.id }}
                  className="rx-card rx-card-grid"
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
                        reworkEstDiff: item.reworkEstDiff,
                        reworkStar: item.reworkStar,
                        lnRatio: item.reworkLnRatio,
                        keyCount: item.keyCount,
                      })}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                      <ResultStat
                        label={dict?.collection.mastery ?? "mastery"}
                        value={
                          item.masteryLevel != null
                            ? item.masteryLevel.toFixed(0)
                            : "—"
                        }
                      />
                      <ResultStat
                        label={dict?.practice.detail.statBestAcc ?? "Best acc"}
                        value={formatAccuracy(item.bestAccuracy)}
                      />
                      <ResultStat
                        label={dict?.practice.detail.statBestPp ?? "Best PP"}
                        value={formatPp(item.bestPp)}
                      />
                      <ResultStat
                        label={
                          dict?.practice.detail.statLastPlayed ?? "Last played"
                        }
                        value={formatRelativeTime(item.lastPlayedAt, dict?.common)}
                      />
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
