import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HubCollectionCard } from "../../components/HubCollectionCard";
import { PageTitle } from "../../components/PageTitle";
import { CardGridSkeleton } from "../../components/LoadingSkeleton";
import {
  HUB_TAGS,
  clearHubJwt,
  fetchHubCollections,
  fetchHubMe,
  useHubJwt,
  useHubUrl,
  type HubTag,
} from "../../lib/hub";
import { HubLoginButton } from "./HubLoginButton";

export function HubBrowsePage() {
  const hubUrl = useHubUrl();
  const queryClient = useQueryClient();
  const [tags, setTags] = useState<HubTag[]>([]);
  const [page, setPage] = useState(0);
  const jwt = useHubJwt();

  const meQuery = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    enabled: !!jwt,
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    retry: false,
  });

  const listQuery = useQuery({
    queryKey: ["hub-collections", hubUrl, tags, page, jwt],
    queryFn: () =>
      fetchHubCollections(hubUrl, {
        page,
        limit: 20,
        tags: tags.length > 0 ? tags : undefined,
        token: jwt,
      }),
  });

  const logout = useMutation({
    mutationFn: async () => {
      clearHubJwt();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hub-me"] });
      void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
    },
  });

  const totalPages = useMemo(() => {
    const total = listQuery.data?.total ?? 0;
    const limit = listQuery.data?.limit ?? 20;
    return Math.max(1, Math.ceil(total / limit));
  }, [listQuery.data]);

  function toggleTag(tag: HubTag) {
    setPage(0);
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function clearTags() {
    setPage(0);
    setTags([]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle>Hub</PageTitle>
          <p className="rx-subtitle">
            Browse and download shared beatmap collections.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {meQuery.data ? (
            <>
              <div className="flex items-center gap-2 text-sm text-muted">
                {meQuery.data.avatarUrl ? (
                  <img
                    src={meQuery.data.avatarUrl}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : null}
                <span className="text-ink">{meQuery.data.username}</span>
              </div>
              <button
                type="button"
                className="rx-btn"
                onClick={() => logout.mutate()}
              >
                Log out
              </button>
            </>
          ) : (
            <HubLoginButton />
          )}
          <Link to="/hub/share" className="rx-btn">
            Share collection
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rx-btn text-xs ${tags.length === 0 ? "rx-btn-primary" : ""}`}
          onClick={clearTags}
        >
          All
        </button>
        {HUB_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            className={`rx-btn text-xs ${tags.includes(t) ? "rx-btn-primary" : ""}`}
            onClick={() => toggleTag(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <CardGridSkeleton count={6} />
      ) : listQuery.error ? (
        <p className="text-sm text-rose-300">{listQuery.error.message}</p>
      ) : !listQuery.data || listQuery.data.data.length === 0 ? (
        <p className="text-sm text-muted">No collections yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listQuery.data.data.map((c) => (
            <li key={c.id}>
              <HubCollectionCard
                collection={{
                  ...c,
                  previewBeatmapsetIds: c.previewBeatmapsetIds ?? [],
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {listQuery.data && listQuery.data.total > (listQuery.data.limit ?? 20) ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="rx-btn"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span className="text-sm text-muted">
            Page {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            className="rx-btn"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
