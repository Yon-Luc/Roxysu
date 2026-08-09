import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OnlineSetCard } from "../../components/OnlineSetCard";
import { PageTitle } from "../../components/PageTitle";
import { CardGridSkeleton, ListSkeleton } from "../../components/LoadingSkeleton";
import {
  fetchBeatmapsetInfo,
  startMirrorBatchJob,
  type OnlineBeatmapSet,
} from "../../lib/api";
import {
  exportHubCollection,
  favoriteHubCollection,
  fetchHubCollection,
  useHubJwt,
  useHubUrl,
} from "../../lib/hub";
import {
  formatHubDominantMode,
  formatHubStarsRange,
} from "../../lib/hubStats";
import { pushToast } from "../../lib/toasts";
import { MIRROR_BATCH_QUERY_KEY } from "../download/useMirrorBatchJob";
import { HubLoginButton } from "./HubLoginButton";

const INFO_BATCH = 100;

async function loadCollectionSetCards(setIds: number[]): Promise<{
  items: OnlineBeatmapSet[];
  missing: number[];
}> {
  const unique = [...new Set(setIds.filter((id) => id > 0))];
  const byId = new Map<number, OnlineBeatmapSet>();
  const missing: number[] = [];

  for (let i = 0; i < unique.length; i += INFO_BATCH) {
    const chunk = unique.slice(i, i + INFO_BATCH);
    if (chunk.length === 0) continue;
    const res = await fetchBeatmapsetInfo(chunk);
    for (const set of res.items) byId.set(set.id, set);
    missing.push(...res.missing);
  }

  return {
    items: unique
      .map((id) => byId.get(id))
      .filter((s): s is OnlineBeatmapSet => s != null),
    missing,
  };
}

function PlaceholderSetCard({
  setId,
  mapName,
}: {
  setId: number;
  mapName: string;
}) {
  return (
    <div className="rx-card flex h-full flex-col p-4">
      <div className="truncate text-sm text-muted">Beatmapset</div>
      <div className="truncate font-bold text-ink">
        {mapName || `Set ${setId}`}
      </div>
      <div className="mt-1 text-xs text-faint">#{setId} · metadata unavailable</div>
      <div className="mt-3">
        <a
          href={`https://osu.ppy.sh/beatmapsets/${setId}`}
          target="_blank"
          rel="noreferrer"
          className="rx-btn"
        >
          Website
        </a>
      </div>
    </div>
  );
}

export function HubDetailPage({ id }: { id: string }) {
  const collectionId = Number(id);
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ["hub-collection", hubUrl, collectionId, jwt],
    enabled: Number.isFinite(collectionId),
    queryFn: () => fetchHubCollection(hubUrl, collectionId, jwt),
  });

  const setIds = detailQuery.data?.maps.map((m) => m.beatmapsetId) ?? [];
  const nameById = new Map(
    (detailQuery.data?.maps ?? []).map((m) => [m.beatmapsetId, m.mapName]),
  );

  const cardsQuery = useQuery({
    queryKey: [
      "hub-collection-cards",
      collectionId,
      detailQuery.dataUpdatedAt,
      setIds.length,
    ],
    enabled: detailQuery.isSuccess && setIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => loadCollectionSetCards(setIds),
  });

  const favoriteMut = useMutation({
    mutationFn: async (favorited: boolean) => {
      if (!jwt) throw new Error("Log in to favorite collections");
      await favoriteHubCollection(hubUrl, collectionId, jwt, favorited);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["hub-collection", hubUrl, collectionId],
      });
      void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
    },
    onError: (err) =>
      pushToast({
        title: "Favorite failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const downloadMut = useMutation({
    mutationFn: async () => {
      const data = await exportHubCollection(hubUrl, collectionId);
      if (!data.beatmapsetIds.length) throw new Error("Collection has no maps");
      return startMirrorBatchJob({
        mode: "setIds",
        setIds: data.beatmapsetIds,
        excludeOwned: true,
        noVideo: true,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MIRROR_BATCH_QUERY_KEY });
      pushToast({
        title: "Download started",
        detail: "Missing maps are downloading in the background.",
        tone: "success",
      });
    },
    onError: (err) =>
      pushToast({
        title: "Download failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const c = detailQuery.data;
  const byId = new Map(
    (cardsQuery.data?.items ?? []).map((set) => [set.id, set]),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/hub" className="text-xs text-muted hover:text-ink">
            ← Hub
          </Link>
          <PageTitle>{c?.name ?? "Collection"}</PageTitle>
          {c ? (
            <p className="rx-subtitle">
              by {c.owner.username}
              {c.description ? ` · ${c.description}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {jwt ? (
            <button
              type="button"
              className="rx-btn"
              disabled={!c || favoriteMut.isPending}
              onClick={() => favoriteMut.mutate(!!c?.favoritedByMe)}
            >
              {c?.favoritedByMe ? "Unfavorite" : "Favorite"}
            </button>
          ) : (
            <HubLoginButton className="rx-btn">Log in to favorite</HubLoginButton>
          )}
          <button
            type="button"
            className="rx-btn-primary"
            disabled={!c || downloadMut.isPending}
            onClick={() => downloadMut.mutate()}
          >
            {downloadMut.isPending ? "Starting…" : "Download missing"}
          </button>
        </div>
      </div>

      {detailQuery.isLoading ? (
        <ListSkeleton count={4} showThumbnail={false} />
      ) : detailQuery.error ? (
        <p className="text-sm text-rose-300">{detailQuery.error.message}</p>
      ) : c ? (
        <>
          <div className="flex flex-wrap gap-4 text-sm text-muted">
            <span>{c.mapCount.toLocaleString()} maps</span>
            <span>{c.downloadCount.toLocaleString()} downloads</span>
            <span>{c.favoriteCount.toLocaleString()} favorites</span>
            {formatHubStarsRange(c.starsMin, c.starsMax) ? (
              <span>{formatHubStarsRange(c.starsMin, c.starsMax)}</span>
            ) : null}
            {formatHubDominantMode(c.dominantMode, c.dominantKeys) ? (
              <span className="capitalize">
                {formatHubDominantMode(c.dominantMode, c.dominantKeys)}
              </span>
            ) : null}
          </div>
          {c.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {c.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-subtle"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          {setIds.length === 0 ? (
            <p className="text-muted">This collection has no maps.</p>
          ) : cardsQuery.isPending && !cardsQuery.data ? (
            <CardGridSkeleton count={6} />
          ) : cardsQuery.error && !cardsQuery.data ? (
            <p className="text-sm text-rose-300">{cardsQuery.error.message}</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {setIds.map((setId) => {
                const set = byId.get(setId);
                return (
                  <li key={setId}>
                    {set ? (
                      <OnlineSetCard set={set} />
                    ) : (
                      <PlaceholderSetCard
                        setId={setId}
                        mapName={nameById.get(setId) ?? ""}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
