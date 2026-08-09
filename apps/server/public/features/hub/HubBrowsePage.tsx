import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(0);
  const jwt = useHubJwt();

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQ(q.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    setPage(0);
  }, [debouncedQ]);

  const meQuery = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    enabled: !!jwt,
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    retry: false,
  });

  const listQuery = useQuery({
    queryKey: ["hub-collections", hubUrl, tags, debouncedQ, page, jwt],
    queryFn: () =>
      fetchHubCollections(hubUrl, {
        page,
        limit: 20,
        q: debouncedQ || undefined,
        tags: tags.length > 0 ? tags : undefined,
        token: jwt,
      }),
    placeholderData: keepPreviousData,
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

  const hasFilters = tags.length > 0 || debouncedQ.length > 0;
  const showSkeleton = listQuery.isPending && !listQuery.isPlaceholderData;

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

      <div className="flex flex-col gap-3">
        <input
          type="search"
          className="rx-input w-full max-w-xl"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, player, mode=m key=7 stars>=5…"
          aria-label="Search collections"
        />
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
      </div>

      {showSkeleton ? (
        <CardGridSkeleton count={6} />
      ) : listQuery.error && !listQuery.data ? (
        <p className="text-sm text-rose-300">{listQuery.error.message}</p>
      ) : !listQuery.data || listQuery.data.data.length === 0 ? (
        <p className="text-sm text-muted">
          {hasFilters
            ? "No collections match your search."
            : "No collections yet."}
        </p>
      ) : (
        <ul
          className={`grid gap-4 transition-opacity duration-150 sm:grid-cols-2 lg:grid-cols-3 ${
            listQuery.isFetching ? "opacity-70" : ""
          }`}
        >
          {listQuery.data.data.map((c) => (
            <li key={c.id}>
              <HubCollectionCard
                collection={{
                  ...c,
                  previewBeatmapsetIds: c.previewBeatmapsetIds ?? [],
                  starsMin: c.starsMin ?? null,
                  starsMax: c.starsMax ?? null,
                  dominantMode: c.dominantMode ?? null,
                  dominantKeys: c.dominantKeys ?? null,
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {listQuery.data && listQuery.data.total > (listQuery.data.limit ?? 20) ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="rx-btn"
            disabled={page <= 0 || listQuery.isFetching}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span className="text-sm text-muted">
            Page {page + 1} / {totalPages}
            {listQuery.isFetching ? " · updating…" : ""}
          </span>
          <button
            type="button"
            className="rx-btn"
            disabled={page + 1 >= totalPages || listQuery.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
