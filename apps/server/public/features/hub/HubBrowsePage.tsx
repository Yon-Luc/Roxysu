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
  fetchHubAddedCollections,
  fetchOwnedSetIds,
  removeHubAddedCollection,
} from "../../lib/api";
import {
  fetchHubCollection,
  fetchHubCollections,
  fetchHubMe,
  clearHubJwt,
  useHubJwt,
  useHubUrl,
  type HubCollectionListItem,
  type HubModeTag,
  type HubTag,
} from "../../lib/hub";
import { pushToast } from "../../lib/toasts";
import { HubLoginButton } from "./HubLoginButton";
import { HubTagFilters } from "./HubTagFilters";

type HubTab = "browse" | "added";

export function HubBrowsePage() {
  const hubUrl = useHubUrl();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<HubTab>("browse");
  const [mode, setMode] = useState<HubModeTag | "all">("all");
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
  }, [debouncedQ, tags, mode, tab]);

  const meQuery = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    enabled: !!jwt,
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    retry: false,
  });

  const ownedQuery = useQuery({
    queryKey: ["owned-set-ids"],
    queryFn: fetchOwnedSetIds,
    staleTime: 60_000,
  });
  const ownedSetIds = useMemo(
    () => new Set(ownedQuery.data ?? []),
    [ownedQuery.data],
  );

  const addedQuery = useQuery({
    queryKey: ["hub-added-collections"],
    queryFn: fetchHubAddedCollections,
  });

  const listQuery = useQuery({
    queryKey: ["hub-collections", hubUrl, tags, debouncedQ, mode, page, jwt],
    enabled: tab === "browse",
    queryFn: () => {
      const modeToken =
        mode === "mania"
          ? "mode=m"
          : mode === "std"
            ? "mode=o"
            : mode === "ctb"
              ? "mode=f"
              : mode === "taiko"
                ? "mode=t"
                : "";
      const qParts = [debouncedQ, modeToken].filter(Boolean);
      return fetchHubCollections(hubUrl, {
        page,
        limit: 20,
        q: qParts.length > 0 ? qParts.join(" ") : undefined,
        tags: tags.length > 0 ? tags : undefined,
        token: jwt,
      });
    },
    placeholderData: keepPreviousData,
  });

  const addedDetailsQuery = useQuery({
    queryKey: [
      "hub-added-details",
      hubUrl,
      addedQuery.dataUpdatedAt,
      debouncedQ,
    ],
    enabled: tab === "added" && !!addedQuery.data,
    queryFn: async () => {
      const items = addedQuery.data?.items ?? [];
      const needle = debouncedQ.toLowerCase();
      const filtered = needle
        ? items.filter((i) => i.name.toLowerCase().includes(needle))
        : items;
      const details: HubCollectionListItem[] = [];
      for (const item of filtered) {
        try {
          const detail = await fetchHubCollection(
            hubUrl,
            item.hubCollectionId,
            jwt,
          );
          details.push(detail);
        } catch {
          // Collection may have been deleted on the hub — keep a stub card.
          details.push({
            id: item.hubCollectionId,
            name: item.name,
            description: "",
            downloadCount: 0,
            mapCount: item.mapCount,
            favoriteCount: 0,
            favoritedByMe: false,
            tags: [],
            previewBeatmapsetIds: item.beatmapsetIds.slice(0, 4),
            beatmapsetIds: item.beatmapsetIds,
            starsMin: null,
            starsMax: null,
            dominantMode: null,
            dominantKeys: null,
            createdAt: item.addedAt ?? new Date(0).toISOString(),
            updatedAt: item.hubUpdatedAt ?? new Date(0).toISOString(),
            owner: { username: "?", avatarUrl: null, osuId: 0 },
          });
        }
      }
      return details;
    },
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

  const removeMut = useMutation({
    mutationFn: (hubCollectionId: number) =>
      removeHubAddedCollection(hubCollectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hub-added-collections"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      pushToast({
        title: "Removed from collection",
        detail: "Unlinked from Roxysu and removed the !Roxysu pack from lazer.",
        tone: "success",
      });
    },
    onError: (err) =>
      pushToast({
        title: "Remove failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const totalPages = useMemo(() => {
    const total = listQuery.data?.total ?? 0;
    const limit = listQuery.data?.limit ?? 20;
    return Math.max(1, Math.ceil(total / limit));
  }, [listQuery.data]);

  const addedById = useMemo(() => {
    const map = new Map<
      number,
      { hubUpdatedAt: string | null }
    >();
    for (const item of addedQuery.data?.items ?? []) {
      map.set(item.hubCollectionId, { hubUpdatedAt: item.hubUpdatedAt });
    }
    return map;
  }, [addedQuery.data]);

  function isUpdateAvailable(c: HubCollectionListItem): boolean {
    const local = addedById.get(c.id);
    if (!local?.hubUpdatedAt || !c.updatedAt) return false;
    return Date.parse(c.updatedAt) > Date.parse(local.hubUpdatedAt);
  }

  const browseHasFilters = tags.length > 0 || debouncedQ.length > 0;
  const showBrowseSkeleton =
    tab === "browse" && listQuery.isPending && !listQuery.isPlaceholderData;
  const showAddedSkeleton =
    tab === "added" &&
    (addedQuery.isPending ||
      (addedDetailsQuery.isPending && !addedDetailsQuery.data));

  const browseItems = listQuery.data?.data ?? [];
  const addedItems = addedDetailsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle>Workshop</PageTitle>
          <p className="rx-subtitle">
            Browse and share beatmap collection packs.
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
          {meQuery.data?.role === "admin" ? (
            <Link to="/hub/admin/cache" className="rx-btn">
              Search cache
            </Link>
          ) : null}
          <Link to="/hub/share" className="rx-btn">
            Share collection
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-highlight/40 pb-3">
        <button
          type="button"
          className={`rx-btn text-sm ${tab === "browse" ? "rx-btn-primary" : ""}`}
          onClick={() => setTab("browse")}
        >
          Search collections
        </button>
        <button
          type="button"
          className={`rx-btn text-sm ${tab === "added" ? "rx-btn-primary" : ""}`}
          onClick={() => setTab("added")}
        >
          Collections added
          {addedQuery.data && addedQuery.data.items.length > 0
            ? ` (${addedQuery.data.items.length})`
            : ""}
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <input
          type="search"
          className="rx-input w-full max-w-xl"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            tab === "added"
              ? "Search added collections…"
              : "Search name, player, mode=m key=7 stars>=5…"
          }
          aria-label="Search collections"
        />
        {tab === "browse" ? (
          <HubTagFilters
            mode={mode}
            tags={tags}
            onModeChange={setMode}
            onTagsChange={setTags}
          />
        ) : null}
      </div>

      {tab === "browse" ? (
        showBrowseSkeleton ? (
          <CardGridSkeleton count={6} />
        ) : listQuery.error && !listQuery.data ? (
          <p className="text-sm text-rose-300">{listQuery.error.message}</p>
        ) : browseItems.length === 0 ? (
          <p className="text-sm text-muted">
            {browseHasFilters
              ? "No collections match your search."
              : "No collections yet."}
          </p>
        ) : (
          <ul
            className={`grid gap-4 transition-opacity duration-150 sm:grid-cols-2 lg:grid-cols-3 ${
              listQuery.isFetching ? "opacity-70" : ""
            }`}
          >
            {browseItems.map((c) => (
              <li key={c.id}>
                <HubCollectionCard
                  collection={{
                    ...c,
                    previewBeatmapsetIds: c.previewBeatmapsetIds ?? [],
                    beatmapsetIds: c.beatmapsetIds ?? [],
                    starsMin: c.starsMin ?? null,
                    starsMax: c.starsMax ?? null,
                    dominantMode: c.dominantMode ?? null,
                    dominantKeys: c.dominantKeys ?? null,
                  }}
                  ownedSetIds={ownedSetIds}
                  updateAvailable={isUpdateAvailable(c)}
                />
              </li>
            ))}
          </ul>
        )
      ) : showAddedSkeleton ? (
        <CardGridSkeleton count={6} />
      ) : addedQuery.error ? (
        <p className="text-sm text-rose-300">{addedQuery.error.message}</p>
      ) : addedItems.length === 0 ? (
        <p className="text-sm text-muted">
          {debouncedQ
            ? "No added collections match your search."
            : "No collections saved from the Workshop yet. Open a collection and tap Save collection."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {addedItems.map((c) => (
            <li key={c.id}>
              <HubCollectionCard
                collection={c}
                ownedSetIds={ownedSetIds}
                updateAvailable={isUpdateAvailable(c)}
                removing={
                  removeMut.isPending && removeMut.variables === c.id
                }
                onRemove={() => removeMut.mutate(c.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {tab === "browse" &&
      listQuery.data &&
      listQuery.data.total > (listQuery.data.limit ?? 20) ? (
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
