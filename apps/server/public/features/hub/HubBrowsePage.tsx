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
  diffSetOwnership,
  removeHubAddedCollection,
} from "../../lib/api";
import {
  fetchHubCollections,
  fetchHubFavorites,
  fetchHubMe,
  clearHubJwt,
  useHubJwt,
  useHubUrl,
  type HubCollectionListItem,
  type HubModeTag,
  type HubTag,
} from "../../lib/hub";
import { pushToast } from "../../lib/toasts";
import { useAppDict, t } from "../../lib/i18n";
import { HubLoginButton } from "./HubLoginButton";
import { HubTagFilters } from "./HubTagFilters";

type HubTab = "browse" | "favorites" | "added";

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
  const { dict } = useAppDict();

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

  const addedQuery = useQuery({
    queryKey: ["hub-added-collections"],
    queryFn: fetchHubAddedCollections,
  });

  const addedSetIds = useMemo(() => {
    const ids = new Set<number>();
    for (const item of addedQuery.data?.items ?? []) {
      for (const id of item.beatmapsetIds) {
        if (id > 0) ids.add(id);
      }
    }
    return [...ids];
  }, [addedQuery.data]);

  const addedOwnedQuery = useQuery({
    queryKey: ["hub-added-owned", addedSetIds],
    enabled: tab === "added" && addedSetIds.length > 0,
    queryFn: () => diffSetOwnership(addedSetIds),
    staleTime: 60_000,
  });
  const ownedSetIds = useMemo(
    () => new Set(addedOwnedQuery.data?.owned ?? []),
    [addedOwnedQuery.data],
  );

  const favoritesQuery = useQuery({
    queryKey: ["hub-favorites", hubUrl, jwt],
    enabled: tab === "favorites" && !!jwt,
    queryFn: () => fetchHubFavorites(hubUrl, jwt!),
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

  const logout = useMutation({
    mutationFn: async () => {
      clearHubJwt();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hub-me"] });
      void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
      void queryClient.invalidateQueries({ queryKey: ["hub-favorites"] });
    },
  });

  const removeMut = useMutation({
    mutationFn: (hubCollectionId: number) =>
      removeHubAddedCollection(hubCollectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hub-added-collections"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      pushToast({
        title: dict?.hub?.removedFromCollection ?? "Removed from collection",
        detail:
          dict?.hub?.removedDetail ??
          "Unlinked from Roxysu and removed the !Roxysu pack from lazer.",
        tone: "success",
      });
    },
    onError: (err) =>
      pushToast({
        title: dict?.hub?.removeFailed ?? "Remove failed",
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

  const browseHasFilters =
    tags.length > 0 || debouncedQ.length > 0 || mode !== "all";
  const showBrowseSkeleton =
    tab === "browse" && listQuery.isPending && !listQuery.isPlaceholderData;
  const showAddedSkeleton = tab === "added" && addedQuery.isPending;

  const browseItems = listQuery.data?.data ?? [];
  const addedItems = useMemo((): HubCollectionListItem[] => {
    const items = addedQuery.data?.items ?? [];
    const needle = debouncedQ.toLowerCase();
    const filtered = needle
      ? items.filter((i) => i.name.toLowerCase().includes(needle))
      : items;
    return filtered.map((item) => ({
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
    }));
  }, [addedQuery.data, debouncedQ]);
  const favoriteItems = useMemo(() => {
    const items = favoritesQuery.data?.data ?? [];
    const needle = debouncedQ.toLowerCase();
    if (!needle) return items;
    return items.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.owner.username.toLowerCase().includes(needle),
    );
  }, [favoritesQuery.data, debouncedQ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle>{dict?.hub?.workshop ?? "Workshop"}</PageTitle>
          <p className="rx-subtitle">
            {dict?.hub?.browseSubtitle ?? "Browse and share beatmap collection packs."}
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
                  {dict?.hub?.logout ?? "Log out"}
                </button>
            </>
          ) : (
            <HubLoginButton />
          )}
          {meQuery.data?.role === "admin" ? (
              <Link to="/hub/admin/cache" className="rx-btn">
                {dict?.hub?.searchCache ?? "Search cache"}
              </Link>
          ) : null}
          <Link to="/hub/share" className="rx-btn">
            {dict?.hub?.shareCollection ?? "Share collection"}
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-highlight/40 pb-3">
        <button
          type="button"
          className={`rx-btn text-sm ${tab === "browse" ? "rx-btn-primary" : ""}`}
          onClick={() => setTab("browse")}
        >
          {dict?.hub?.tabBrowse ?? "Search collections"}
        </button>
        <button
          type="button"
          className={`rx-btn text-sm ${tab === "favorites" ? "rx-btn-primary" : ""}`}
          onClick={() => setTab("favorites")}
        >
          {t(dict?.hub?.tabFavorites ?? "Favorites")}
          {favoritesQuery.data && favoritesQuery.data.data.length > 0
            ? ` (${favoritesQuery.data.data.length})`
            : ""}
        </button>
        <button
          type="button"
          className={`rx-btn text-sm ${tab === "added" ? "rx-btn-primary" : ""}`}
          onClick={() => setTab("added")}
        >
          {t(dict?.hub?.tabAdded ?? "Collections added")}
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
              ? (dict?.hub?.searchAddedPlaceholder ?? "Search added collections…")
              : tab === "favorites"
                ? (dict?.hub?.searchFavoritesPlaceholder ?? "Search favorites…")
                : (dict?.hub?.searchBrowsePlaceholder ?? "Search name, player, mode=m key=7 stars>=5…")
          }
          aria-label={dict?.hub?.searchAria ?? "Search collections"}
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
          <p className="text-sm text-danger">{listQuery.error.message}</p>
        ) : browseItems.length === 0 ? (
          <p className="text-sm text-muted">
            {browseHasFilters
              ? (dict?.hub?.noMatchSearch ?? "No collections match your search.")
              : (dict?.hub?.noCollectionsYet ?? "No collections yet.")}
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
                    starsMin: c.starsMin ?? null,
                    starsMax: c.starsMax ?? null,
                    dominantMode: c.dominantMode ?? null,
                    dominantKeys: c.dominantKeys ?? null,
                  }}
                  updateAvailable={isUpdateAvailable(c)}
                />
              </li>
            ))}
          </ul>
        )
      ) : tab === "favorites" ? (
        !jwt ? (
          <p className="text-sm text-muted">{dict?.hub?.loginToSeeFavorites ?? "Log in to see collections you favorited."}</p>
        ) : favoritesQuery.isPending ? (
          <CardGridSkeleton count={6} />
        ) : favoritesQuery.error ? (
          <p className="text-sm text-danger">{favoritesQuery.error.message}</p>
        ) : favoriteItems.length === 0 ? (
          <p className="text-sm text-muted">
            {debouncedQ
              ? (dict?.hub?.noFavoritesMatch ?? "No favorites match your search.")
              : (dict?.hub?.noFavoritesYet ?? "No favorites yet. Open a collection and tap Favorite.")}
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {favoriteItems.map((c) => (
              <li key={c.id}>
                <HubCollectionCard
                  collection={c}
                  updateAvailable={isUpdateAvailable(c)}
                />
              </li>
            ))}
          </ul>
        )
      ) : showAddedSkeleton ? (
        <CardGridSkeleton count={6} />
      ) : addedQuery.error ? (
        <p className="text-sm text-danger">{addedQuery.error.message}</p>
      ) : addedItems.length === 0 ? (
        <p className="text-sm text-muted">
          {debouncedQ
            ? (dict?.hub?.noAddedMatch ?? "No added collections match your search.")
            : (dict?.hub?.noAddedYet ?? "No collections saved from the Workshop yet. Open a collection and tap Save collection.")}
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
              {dict?.hub?.previous ?? "Previous"}
            </button>
            <span className="text-sm text-muted">
              {t(dict?.hub?.pageOf ?? "Page {{current}} / {{total}}", {
                current: page + 1,
                total: totalPages,
              })}
              {listQuery.isFetching
                ? (dict?.hub?.updating ?? " · updating…")
                : ""}
            </span>
            <button
              type="button"
              className="rx-btn"
              disabled={page + 1 >= totalPages || listQuery.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              {dict?.hub?.next ?? "Next"}
            </button>
        </div>
      ) : null}
    </div>
  );
}
