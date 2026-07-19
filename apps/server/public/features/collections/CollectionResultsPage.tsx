import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BeatmapCover } from "../../components/BeatmapCover";
import { fetchCollectionResults } from "../../lib/api";
import {
  formatAccuracy,
  formatPp,
  formatRelativeTime,
  formatStars,
} from "../../lib/format";

export function CollectionResultsPage({
  collectionId,
}: {
  collectionId: string;
}) {
  const id = Number(collectionId);
  const { data, isLoading, error } = useQuery({
    queryKey: ["collections", id, "results"],
    queryFn: () => fetchCollectionResults(id, { page: 1, pageSize: 48 }),
    enabled: Number.isFinite(id),
  });

  const payload =
    data && "collection" in data && data.collection ? data : null;

  if (isLoading) {
    return <p className="text-[#8b93a7]">Loading collection…</p>;
  }

  if (error || !payload) {
    return (
      <div className="space-y-3">
        <Link
          to="/collections"
          className="text-sm text-[#8b93a7] hover:text-white"
        >
          ← Collections
        </Link>
        <p className="text-rose-300">{error?.message ?? "Not found"}</p>
      </div>
    );
  }

  const { collection, items, total } = payload;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/collections"
          className="text-sm text-[#8b93a7] hover:text-white"
        >
          ← Collections
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">
          {collection.name}
        </h1>
        <p className="mt-1 font-mono text-sm text-[#8b93a7]">
          {collection.query}
        </p>
        <p className="mt-1 text-xs text-[#6b7385]">
          {total.toLocaleString()} matches
        </p>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-[#8b93a7]">No matches.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/practice/$beatmapId"
                params={{ beatmapId: item.id }}
                className="block h-full overflow-hidden rounded-lg border border-white/10 bg-[#151922] transition hover:border-white/20"
              >
                <BeatmapCover
                  backgroundFileHash={item.backgroundFileHash}
                  setOnlineId={item.setOnlineId}
                  size="card"
                  className="aspect-[2.2/1] w-full"
                  alt=""
                />
                <div className="p-4">
                  <div className="truncate text-sm text-[#8b93a7]">
                    {item.artist}
                  </div>
                  <div className="truncate font-medium text-white">
                    {item.title}
                  </div>
                  <div className="mt-1 text-xs text-[#8b93a7]">
                    [{item.difficultyName}] · {formatStars(item.starRating)}
                  </div>
                  <div className="mt-2 flex gap-3 text-xs tabular-nums text-[#a8b0c0]">
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
