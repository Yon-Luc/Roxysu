import { Link } from "@tanstack/react-router";
import { BeatmapCover } from "./BeatmapCover";
import type { HubCollectionListItem } from "../lib/hub";

const PREVIEW_SLOTS = 4;

export function HubCollectionCard({
  collection,
}: {
  collection: HubCollectionListItem;
}) {
  const previews = Array.from(
    { length: PREVIEW_SLOTS },
    (_, i) => collection.previewBeatmapsetIds[i] ?? 0,
  );

  return (
    <Link
      to="/hub/$id"
      params={{ id: String(collection.id) }}
      className="rx-card flex h-full flex-col transition hover:bg-elevated/40"
    >
      <div className="grid aspect-[2.2/1] w-full grid-cols-4 overflow-hidden">
        {previews.map((setId, index) =>
          setId > 0 ? (
            <BeatmapCover
              key={`${setId}-${index}`}
              setOnlineId={setId}
              size="card"
              className="h-full w-full min-h-0"
              alt=""
            />
          ) : (
            <div
              key={`empty-${index}`}
              aria-hidden
              className="h-full w-full bg-gradient-to-br from-elevated to-canvas"
            />
          ),
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="truncate font-bold text-ink">{collection.name}</div>
        {collection.description ? (
          <div className="mt-1 line-clamp-2 text-xs text-muted">
            {collection.description}
          </div>
        ) : null}

        <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted">
          {collection.owner.avatarUrl ? (
            <img
              src={collection.owner.avatarUrl}
              alt=""
              className="h-5 w-5 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-highlight text-[10px] font-medium text-subtle"
            >
              {collection.owner.username.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate text-ink">{collection.owner.username}</span>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
          <span>{collection.mapCount.toLocaleString()} maps</span>
          <span>{collection.downloadCount.toLocaleString()} downloads</span>
          <span>{collection.favoriteCount.toLocaleString()} favorites</span>
        </div>

        {collection.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {collection.tags.map((tagName) => (
              <span
                key={tagName}
                className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-subtle"
              >
                {tagName}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
