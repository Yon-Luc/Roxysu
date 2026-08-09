import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { ListSkeleton } from "../../components/LoadingSkeleton";
import { startMirrorBatchJob } from "../../lib/api";
import {
  exportHubCollection,
  favoriteHubCollection,
  fetchHubCollection,
  getHubJwt,
  hubLoginUrl,
  useHubUrl,
} from "../../lib/hub";
import { pushToast } from "../../lib/toasts";
import { MIRROR_BATCH_QUERY_KEY } from "../download/useMirrorBatchJob";

export function HubDetailPage({ id }: { id: string }) {
  const collectionId = Number(id);
  const hubUrl = useHubUrl();
  const jwt = getHubJwt();
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ["hub-collection", hubUrl, collectionId, jwt],
    enabled: Number.isFinite(collectionId),
    queryFn: () => fetchHubCollection(hubUrl, collectionId, jwt),
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
            <a href={hubLoginUrl(hubUrl)} className="rx-btn">
              Log in to favorite
            </a>
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
          <ul className="max-h-[28rem] space-y-1 overflow-auto rounded-xl bg-surface p-3 text-sm">
            {c.maps.map((m) => (
              <li key={m.beatmapsetId} className="flex justify-between gap-3">
                <span className="truncate text-ink">
                  {m.mapName || `Beatmapset ${m.beatmapsetId}`}
                </span>
                <span className="shrink-0 tabular-nums text-subtle">
                  {m.beatmapsetId}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
