import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BeatmapCover } from "../../components/BeatmapCover";
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

export function CollectionResultsPage({
  collectionId,
}: {
  collectionId: string;
}) {
  const ratingMode = useRatingDisplayMode();
  const id = Number(collectionId);
  const { data, isLoading, error } = useQuery({
    queryKey: ["collections", id, "results"],
    queryFn: () => fetchCollectionResults(id, { page: 1, pageSize: 48 }),
    enabled: Number.isFinite(id),
  });

  const payload =
    data && "collection" in data && data.collection ? data : null;

  if (isLoading) {
    return <p className="text-muted">Loading collection…</p>;
  }

  if (error || !payload) {
    return (
      <div className="space-y-3">
        <Link to="/collections" className="rx-back">
          ← Collections
        </Link>
        <p className="text-rose-300">{error?.message ?? "Not found"}</p>
      </div>
    );
  }

  const { collection, items, total } = payload;

  return (
    <div className="space-y-8">
      <div>
        <Link to="/collections" className="rx-back">
          ← Collections
        </Link>
        <PageTitle className="mt-3">{collection.name}</PageTitle>
        <p className="mt-2 font-mono text-sm text-muted">{collection.query}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-xs text-faint">
            {total.toLocaleString()} matches
          </p>
          {total > 0 && (
            <a
              href={`/api/collections/${collection.id}/export`}
              className="rx-btn"
              download
            >
              Export collection
            </a>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">No matches.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
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
                />
                <div className="p-4">
                  <div className="truncate text-sm text-muted">{item.artist}</div>
                  <div className="truncate font-bold text-ink">{item.title}</div>
                  <div className="mt-1 text-xs text-muted">
                    [{item.difficultyName}] ·{" "}
                    {formatPrimaryRating({
                      mode: ratingMode,
                      starRating: item.starRating,
                      sunnyEstDiff: item.sunnyEstDiff,
                      sunnyStar: item.sunnyStar,
                    })}
                  </div>
                  <div className="mt-2 flex gap-3 text-xs tabular-nums text-subtle">
                    <span>
                      {item.masteryLevel != null
                        ? item.masteryLevel.toFixed(0)
                        : "—"}{" "}
                      mastery
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
      )}
    </div>
  );
}
