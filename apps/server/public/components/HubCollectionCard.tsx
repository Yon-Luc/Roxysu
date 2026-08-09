import { Link } from "@tanstack/react-router";
import { BeatmapCover } from "./BeatmapCover";
import type { HubCollectionListItem } from "../lib/hub";
import {
  formatHubDominantMode,
  formatHubStarsRange,
} from "../lib/hubStats";
import {
  formatOwnedMapsLabel,
  ownedCountForSets,
} from "../lib/hubOwnership";
import { osuWebUserUrl } from "../lib/osuUrls";

const PREVIEW_SLOTS = 4;

export function HubCollectionCard({
  collection,
  ownedSetIds,
  updateAvailable,
  onRemove,
  removing,
}: {
  collection: HubCollectionListItem;
  ownedSetIds?: ReadonlySet<number>;
  updateAvailable?: boolean;
  /** Shown on the Collections added tab — removes the local/lazer save. */
  onRemove?: () => void;
  removing?: boolean;
}) {
  const previews = Array.from(
    { length: PREVIEW_SLOTS },
    (_, i) => collection.previewBeatmapsetIds[i] ?? 0,
  );
  const profileUrl = osuWebUserUrl(collection.owner.osuId);
  const starsLabel = formatHubStarsRange(
    collection.starsMin,
    collection.starsMax,
  );
  const modeLabel = formatHubDominantMode(
    collection.dominantMode,
    collection.dominantKeys,
  );
  const ownership = ownedCountForSets(
    collection.beatmapsetIds?.length
      ? collection.beatmapsetIds
      : collection.previewBeatmapsetIds,
    ownedSetIds,
  );

  return (
    <div className="rx-card relative flex h-full flex-col transition hover:bg-elevated/40">
      <Link
        to="/hub/$id"
        params={{ id: String(collection.id) }}
        className="absolute inset-0 z-0 rounded-[inherit]"
        aria-label={collection.name}
      />

      <div className="pointer-events-none relative z-10 flex flex-1 flex-col">
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
          <div className="flex items-start justify-between gap-2">
            <div className="truncate font-bold text-ink">{collection.name}</div>
            {updateAvailable ? (
              <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-200">
                Update
              </span>
            ) : null}
          </div>
          {collection.description ? (
            <div className="mt-1 line-clamp-2 text-xs text-muted">
              {collection.description}
            </div>
          ) : null}

          {starsLabel || modeLabel ? (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
              {starsLabel ? <span>{starsLabel}</span> : null}
              {modeLabel ? <span className="capitalize">{modeLabel}</span> : null}
            </div>
          ) : null}

          <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted">
            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                className="pointer-events-auto relative z-20 flex min-w-0 items-center gap-2 hover:text-ink"
                onClick={(e) => e.stopPropagation()}
              >
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
                <span className="truncate underline-offset-2 hover:underline">
                  {collection.owner.username}
                </span>
              </a>
            ) : (
              <>
                {collection.owner.avatarUrl ? (
                  <img
                    src={collection.owner.avatarUrl}
                    alt=""
                    className="h-5 w-5 shrink-0 rounded-full object-cover"
                  />
                ) : null}
                <span className="truncate text-ink">
                  {collection.owner.username}
                </span>
              </>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
            {ownership ? (
              <span>
                {formatOwnedMapsLabel(ownership.owned, ownership.total)}
              </span>
            ) : (
              <span>{collection.mapCount.toLocaleString()} maps</span>
            )}
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

          {onRemove ? (
            <div className="mt-3">
              <button
                type="button"
                className="pointer-events-auto relative z-20 rx-btn text-xs text-rose-200 hover:bg-rose-500/15"
                disabled={removing}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove();
                }}
              >
                {removing ? "Removing…" : "Remove from collection"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
