import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { ConfirmModal } from "../../components/ConfirmModal";
import { GoBackLink } from "../../components/GoBackLink";
import { OnlineSetCard } from "../../components/OnlineSetCard";
import { PageTitle } from "../../components/PageTitle";
import { CardGridSkeleton, ListSkeleton } from "../../components/LoadingSkeleton";
import {
  fetchBeatmapsetInfo,
  fetchHubAddedCollections,
  diffSetOwnership,
  saveHubAddedCollection,
  startMirrorBatchJob,
  type OnlineBeatmapSet,
} from "../../lib/api";
import {
  favoriteHubCollection,
  fetchHubCollection,
  fetchHubMe,
  updateHubCollection,
  deleteHubCollection,
  exportHubCollection,
  useHubJwt,
  useHubUrl,
  type HubModeTag,
  type HubTag,
  HUB_MODE_LABELS,
  HUB_MODE_TAGS,
  HUB_TAGS,
} from "../../lib/hub";
import {
  formatHubDominantMode,
  formatHubStarsRange,
} from "../../lib/hubStats";
import {
  formatOwnedMapsLabel,
  ownedCountForSets,
} from "../../lib/hubOwnership";
import { pushToast } from "../../lib/toasts";
import { useAppDict, t } from "../../lib/i18n";
import { MIRROR_BATCH_QUERY_KEY } from "../download/useMirrorBatchJob";
import {
  collectPackKeys,
  DEFAULT_MAP_FILTERS,
  filterAndSortCollectionMaps,
  hasAdvancedMapFilters,
  type HubCollectionMapFilterState,
  type MapOwnershipFilter,
  type MapSort,
} from "./hubCollectionMapFilters";
import { HubLoginButton } from "./HubLoginButton";
import { HubTagFilters } from "./HubTagFilters";

const OWNERSHIP_VALUES: MapOwnershipFilter[] = ["all", "missing", "owned"];

const SORT_VALUES: MapSort[] = [
  "stars_desc",
  "stars_asc",
  "name_asc",
  "name_desc",
  "ranked_desc",
  "collection",
];

const INFO_BATCH = 100;
const MAP_PAGE_SIZE = 48;

function hashSetIds(ids: number[]): string {
  let h = ids.length;
  for (const id of ids) h = Math.imul(h, 31) + id;
  return `${ids.length}:${h >>> 0}`;
}

async function loadCollectionSetCards(setIds: number[]): Promise<{
  items: OnlineBeatmapSet[];
  missing: number[];
}> {
  const unique = [...new Set(setIds.filter((id) => id > 0))];
  const byId = new Map<number, OnlineBeatmapSet>();
  const missing: number[] = [];
  const chunks: number[][] = [];

  for (let i = 0; i < unique.length; i += INFO_BATCH) {
    chunks.push(unique.slice(i, i + INFO_BATCH));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      if (chunk.length === 0) return;
      const res = await fetchBeatmapsetInfo(chunk);
      for (const set of res.items) byId.set(set.id, set);
      missing.push(...res.missing);
    }),
  );

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
  owned,
}: {
  setId: number;
  mapName: string;
  owned?: boolean;
}) {
  const { dict } = useAppDict();
  return (
    <div className="rx-card flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="truncate text-sm text-muted">{dict?.hub?.beatmapset ?? "Beatmapset"}</div>
        {owned ? (
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/90 text-ink"
            title={dict?.hub?.alreadyOwned ?? "Already owned"}
            aria-label={dict?.hub?.alreadyOwned ?? "Already owned"}
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="truncate font-bold text-ink">
        {mapName || t(dict?.hub?.setLabel ?? "Set {{id}}", { id: setId })}
      </div>
      <div className="mt-1 text-xs text-faint">#{setId} · {dict?.hub?.metadataUnavailable ?? "metadata unavailable"}</div>
      <div className="mt-3">
        <a
          href={`https://osu.ppy.sh/beatmapsets/${setId}`}
          target="_blank"
          rel="noreferrer"
          className="rx-btn"
        >
          {dict?.hub?.website ?? "Website"}
        </a>
      </div>
    </div>
  );
}

function initialEditMode(tags: string[]): HubModeTag | "all" {
  for (const m of HUB_MODE_TAGS) {
    if (tags.includes(m)) return m;
  }
  return "all";
}

export function HubDetailPage({ id }: { id: string }) {
  const collectionId = Number(id);
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { dict } = useAppDict();

  const ownershipLabel = (v: MapOwnershipFilter): string =>
    v === "all"
      ? (dict?.hub?.ownershipAll ?? "All")
      : v === "missing"
        ? (dict?.hub?.ownershipMissing ?? "Not owned")
        : (dict?.hub?.ownershipOwned ?? "Owned");

  const sortLabel = (v: MapSort): string => {
    switch (v) {
      case "stars_desc":
        return dict?.hub?.sortHighestStars ?? "Highest stars";
      case "stars_asc":
        return dict?.hub?.sortLowestStars ?? "Lowest stars";
      case "name_asc":
        return dict?.hub?.sortNameAsc ?? "Name A–Z";
      case "name_desc":
        return dict?.hub?.sortNameDesc ?? "Name Z–A";
      case "ranked_desc":
        return dict?.hub?.sortNewestRanked ?? "Newest ranked";
      case "collection":
        return dict?.hub?.sortCollectionOrder ?? "Collection order";
      default:
        return v;
    }
  };

  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState<HubTag[]>([]);
  const [editMode, setEditMode] = useState<HubModeTag | "all">("all");
  const [mapFilters, setMapFilters] =
    useState<HubCollectionMapFilterState>(DEFAULT_MAP_FILTERS);
  const [debouncedMapQ, setDebouncedMapQ] = useState("");
  const [mapPage, setMapPage] = useState(1);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedMapQ(mapFilters.q);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [mapFilters.q]);

  function patchMapFilters(patch: Partial<HubCollectionMapFilterState>) {
    setMapFilters((prev) => ({ ...prev, ...patch }));
  }

  const detailQuery = useQuery({
    queryKey: ["hub-collection", hubUrl, collectionId, jwt],
    enabled: Number.isFinite(collectionId),
    queryFn: () => fetchHubCollection(hubUrl, collectionId, jwt),
  });

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

  const setIds = useMemo(
    () => detailQuery.data?.maps.map((m) => m.beatmapsetId) ?? [],
    [detailQuery.data?.maps],
  );
  const nameById = useMemo(
    () =>
      new Map(
        (detailQuery.data?.maps ?? []).map((m) => [m.beatmapsetId, m.mapName]),
      ),
    [detailQuery.data?.maps],
  );

  const setIdsKey = useMemo(() => hashSetIds(setIds), [setIds]);

  const ownedQuery = useQuery({
    queryKey: ["hub-collection-owned", collectionId, setIdsKey],
    enabled: setIds.length > 0,
    queryFn: () => diffSetOwnership(setIds),
    staleTime: 60_000,
  });
  const ownedSetIds = useMemo(
    () => new Set(ownedQuery.data?.owned ?? []),
    [ownedQuery.data],
  );

  const cardsQuery = useQuery({
    queryKey: [
      "hub-collection-cards",
      collectionId,
      setIdsKey,
    ],
    enabled: detailQuery.isSuccess && setIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => loadCollectionSetCards(setIds),
  });

  const ownership = ownedCountForSets(setIds, ownedSetIds);
  const missingCount = ownership
    ? Math.max(0, ownership.total - ownership.owned)
    : 0;

  const addedLocal = addedQuery.data?.items.find(
    (i) => i.hubCollectionId === collectionId,
  );
  const isAdded = !!addedLocal;
  const updateAvailable =
    !!addedLocal?.hubUpdatedAt &&
    !!detailQuery.data?.updatedAt &&
    Date.parse(detailQuery.data.updatedAt) >
      Date.parse(addedLocal.hubUpdatedAt);

  const isOwner =
    !!meQuery.data &&
    !!detailQuery.data &&
    meQuery.data.osuId === detailQuery.data.owner.osuId;
  const canManage = isOwner || meQuery.data?.role === "admin";

  useEffect(() => {
    const c = detailQuery.data;
    if (!c || !editing) return;
    setEditName(c.name);
    setEditDescription(c.description);
    setEditTags(
      c.tags.filter((t): t is HubTag =>
        (HUB_TAGS as readonly string[]).includes(t),
      ),
    );
    setEditMode(initialEditMode(c.tags));
  }, [detailQuery.data, editing]);

  const favoriteMut = useMutation({
    mutationFn: async (favorited: boolean) => {
      if (!jwt) throw new Error(dict?.hub?.loginToFavoriteError ?? "Log in to favorite collections");
      await favoriteHubCollection(hubUrl, collectionId, jwt, favorited);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["hub-collection", hubUrl, collectionId],
      });
      void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
      void queryClient.invalidateQueries({ queryKey: ["hub-favorites"] });
    },
    onError: (err) =>
      pushToast({
        title: dict?.hub?.favoriteFailed ?? "Favorite failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const editMut = useMutation({
    mutationFn: async () => {
      if (!jwt) throw new Error(dict?.hub?.loginToEditError ?? "Log in to edit");
      await updateHubCollection(hubUrl, jwt, collectionId, {
        name: editName.trim(),
        description: editDescription,
        tags: editTags,
      });
    },
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({
        queryKey: ["hub-collection", hubUrl, collectionId],
      });
      void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
      void queryClient.invalidateQueries({ queryKey: ["hub-favorites"] });
      pushToast({ title: dict?.hub?.collectionUpdated ?? "Collection updated", tone: "success" });
    },
    onError: (err) =>
      pushToast({
        title: dict?.hub?.editFailed ?? "Edit failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const c = detailQuery.data;
      if (!c) throw new Error(dict?.hub?.collectionNotLoaded ?? "Collection not loaded");
      const fromIds = c.beatmapsetIds ?? [];
      const beatmapsetIds =
        fromIds.length > 0
          ? fromIds
          : c.maps.map((m) => m.beatmapsetId);
      if (!beatmapsetIds.length) throw new Error(dict?.hub?.collectionNoMapsError ?? "Collection has no maps");

      try {
        await exportHubCollection(hubUrl, collectionId);
      } catch {
        // Export increments downloadCount; a 429 must not block local save.
      }

      const saved = await saveHubAddedCollection({
        hubCollectionId: collectionId,
        name: c.name,
        beatmapsetIds,
        hubUpdatedAt: c.updatedAt,
        syncLazer: true,
      });

      if (saved.ownership.missingCount > 0) {
        await startMirrorBatchJob({
          mode: "setIds",
          setIds: saved.ownership.missing,
          excludeOwned: true,
          noVideo: true,
        });
      }

      return saved;
    },
    onSuccess: (saved) => {
      setSaveOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["hub-added-collections"] });
      void queryClient.invalidateQueries({ queryKey: ["owned-set-ids"] });
      void queryClient.invalidateQueries({ queryKey: MIRROR_BATCH_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({
        queryKey: ["hub-collection", hubUrl, collectionId],
      });
      pushToast({
        title: updateAvailable
          ? (dict?.hub?.savedInGameTitle ?? "Collection updated in game")
          : (dict?.hub?.collectionSavedTitle ?? "Collection saved"),
        detail:
          saved.ownership.missingCount > 0
            ? t(dict?.hub?.savedMissingDetail ?? "{{count}} missing maps are downloading. Synced as !Roxysu {{name}}.", {
                count: saved.ownership.missingCount.toLocaleString(),
                name: detailQuery.data?.name ?? "",
              })
            : t(dict?.hub?.savedDetail ?? "Synced to lazer as !Roxysu {{name}}.", {
                name: detailQuery.data?.name ?? "",
              }),
        tone: "success",
      });
    },
    onError: (err) =>
      pushToast({
        title: dict?.hub?.saveFailed ?? "Save failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!jwt) throw new Error(dict?.hub?.loginToDeleteError ?? "Log in to delete");
      await deleteHubCollection(hubUrl, jwt, collectionId);
    },
    onSuccess: () => {
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
      void queryClient.invalidateQueries({ queryKey: ["hub-favorites"] });
      pushToast({
        title: dict?.hub?.collectionDeleted ?? "Collection deleted",
        detail: dict?.hub?.deletedDetail ?? "Removed from Workshop. Your local copy is unchanged.",
        tone: "success",
      });
      void navigate({ to: "/hub" });
    },
    onError: (err) =>
      pushToast({
        title: dict?.hub?.deleteFailed ?? "Delete failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const c = detailQuery.data;
  const byId = useMemo(
    () => new Map((cardsQuery.data?.items ?? []).map((set) => [set.id, set])),
    [cardsQuery.data?.items],
  );

  const packKeys = useMemo(
    () => collectPackKeys(cardsQuery.data?.items ?? []),
    [cardsQuery.data?.items],
  );
  const showKeysFilter =
    (mapFilters.mode === "all" || mapFilters.mode === "mania") &&
    (packKeys.length > 0 || mapFilters.keys != null);
  const advancedFiltersActive = hasAdvancedMapFilters(mapFilters);

  const filteredMaps = useMemo(() => {
    const rows = setIds.map((setId, collectionIndex) => ({
      setId,
      mapName: nameById.get(setId) ?? "",
      set: byId.get(setId),
      owned: ownedSetIds.has(setId),
      collectionIndex,
    }));
    return filterAndSortCollectionMaps(rows, {
      ...mapFilters,
      q: debouncedMapQ,
    });
  }, [setIds, nameById, byId, ownedSetIds, mapFilters, debouncedMapQ]);

  useEffect(() => {
    setMapPage(1);
  }, [debouncedMapQ, mapFilters.ownership, mapFilters.sort, mapFilters.mode, mapFilters.keys, collectionId]);

  const visibleMaps = filteredMaps.slice(0, mapPage * MAP_PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <GoBackLink to="/hub">{dict?.hub?.workshop ?? "Workshop"}</GoBackLink>
          <PageTitle>{c?.name ?? (dict?.hub?.collection ?? "Collection")}</PageTitle>
          {c ? (
            <p className="rx-subtitle">
              {t(dict?.hub?.by ?? "by {{username}}", {
                username: c.owner.username,
              })}
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
              {c?.favoritedByMe
                ? (dict?.hub?.unfavorite ?? "Unfavorite")
                : (dict?.hub?.favorite ?? "Favorite")}
            </button>
          ) : (
            <HubLoginButton className="rx-btn">
              {dict?.hub?.loginToFavorite ?? "Log in to favorite"}
            </HubLoginButton>
          )}
          {canManage ? (
            <button
              type="button"
              className="rx-btn"
              disabled={!c}
              onClick={() => setEditing((v) => !v)}
            >
              {editing
                ? (dict?.hub?.cancelEdit ?? "Cancel edit")
                : (dict?.hub?.edit ?? "Edit")}
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className="rx-btn"
              disabled={!c || deleteMut.isPending}
              onClick={() => setDeleteOpen(true)}
            >
              {dict?.hub?.delete ?? "Delete"}
            </button>
          ) : null}
          {updateAvailable ? (
            <button
              type="button"
              className="rx-btn-primary"
              disabled={!c || saveMut.isPending}
              onClick={() => setSaveOpen(true)}
            >
              {dict?.hub?.updateInGame ?? "Update in game"}
            </button>
          ) : (
            <button
              type="button"
              className="rx-btn-primary"
              disabled={!c || saveMut.isPending}
              onClick={() => setSaveOpen(true)}
            >
              {isAdded
                ? (dict?.hub?.resaveCollection ?? "Re-save collection")
                : (dict?.hub?.saveCollection ?? "Save collection")}
            </button>
          )}
        </div>
      </div>

      {detailQuery.isLoading ? (
        <ListSkeleton count={4} showThumbnail={false} />
      ) : detailQuery.error ? (
        <p className="text-sm text-danger">{detailQuery.error.message}</p>
      ) : c ? (
        <>
          {editing ? (
            <section className="rx-panel space-y-4 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-ink">{dict?.hub?.editCollection ?? "Edit collection"}</h2>
              <label className="block space-y-1.5 text-sm">
                <span className="rx-label">{dict?.hub?.name ?? "Name"}</span>
                <input
                  className="rx-input w-full"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={100}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="rx-label">{dict?.hub?.description ?? "Description"}</span>
                <textarea
                  className="rx-textarea min-h-[5rem] w-full resize-y"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  maxLength={500}
                />
              </label>
              <div className="space-y-2">
                <span className="rx-label">{dict?.hub?.tags ?? "Tags"}</span>
                <HubTagFilters
                  mode={editMode}
                  tags={editTags}
                  onModeChange={setEditMode}
                  onTagsChange={setEditTags}
                  selectModeAsTag
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="rx-btn-primary"
                  disabled={
                    !editName.trim() ||
                    editTags.length === 0 ||
                    editMut.isPending
                  }
                  onClick={() => editMut.mutate()}
                >
                  {editMut.isPending
                    ? (dict?.hub?.saving ?? "Saving…")
                    : (dict?.hub?.saveChanges ?? "Save changes")}
                </button>
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-4 text-sm text-muted">
            {ownership ? (
              <span>
                {formatOwnedMapsLabel(ownership.owned, ownership.total)}
              </span>
            ) : (
              <span>{t(dict?.hub?.mapsCount ?? "{{count}} maps", { count: c.mapCount.toLocaleString() })}</span>
            )}
            <span>{t(dict?.hub?.downloadsCount ?? "{{count}} downloads", { count: c.downloadCount.toLocaleString() })}</span>
            <span>{t(dict?.hub?.favoritesCount ?? "{{count}} favorites", { count: c.favoriteCount.toLocaleString() })}</span>
            {formatHubStarsRange(c.starsMin, c.starsMax) ? (
              <span>{formatHubStarsRange(c.starsMin, c.starsMax)}</span>
            ) : null}
            {formatHubDominantMode(c.dominantMode, c.dominantKeys) ? (
              <span className="capitalize">
                {formatHubDominantMode(c.dominantMode, c.dominantKeys)}
              </span>
            ) : null}
            {isAdded ? (
              <span className="text-success/90">{dict?.hub?.savedToGame ?? "Saved to game"}</span>
            ) : null}
            {updateAvailable ? (
              <span className="text-warning">{dict?.hub?.creatorUpdated ?? "Creator updated this pack"}</span>
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
            <p className="text-muted">{dict?.hub?.noMaps ?? "This collection has no maps."}</p>
          ) : cardsQuery.isPending && !cardsQuery.data ? (
            <CardGridSkeleton count={6} />
          ) : cardsQuery.error && !cardsQuery.data ? (
            <p className="text-sm text-danger">{cardsQuery.error.message}</p>
          ) : (
            <div className="space-y-4">
              <section className="rx-panel space-y-3 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted">
                    {dict?.hub?.searchMaps ?? "Search maps"}
                    <input
                      className="rx-input w-full"
                      value={mapFilters.q}
                      onChange={(e) => patchMapFilters({ q: e.target.value })}
                      placeholder={dict?.hub?.searchMapsPlaceholder ?? "Title, artist, mapper, or set id"}
                      aria-label={dict?.hub?.searchMapsAria ?? "Search maps in collection"}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-muted">
                    {dict?.hub?.sort ?? "Sort"}
                    <select
                      className="rx-select"
                      value={mapFilters.sort}
                      onChange={(e) =>
                        patchMapFilters({ sort: e.target.value as MapSort })
                      }
                      aria-label={dict?.hub?.sortMapsAria ?? "Sort maps"}
                    >
                      {SORT_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {sortLabel(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={`rx-btn shrink-0 text-xs ${
                      moreFiltersOpen || advancedFiltersActive
                        ? "rx-btn-primary"
                        : ""
                    }`}
                    aria-expanded={moreFiltersOpen}
                    onClick={() => setMoreFiltersOpen((v) => !v)}
                  >
                    {moreFiltersOpen
                      ? (dict?.hub?.fewerFilters ?? "Fewer filters")
                      : (dict?.hub?.moreFilters ?? "More filters")}
                    {advancedFiltersActive && !moreFiltersOpen
                      ? (dict?.hub?.onSuffix ?? " · on")
                      : ""}
                  </button>
                </div>

                {moreFiltersOpen ? (
                  <div className="space-y-3 border-t border-white/10 pt-3">
                    <div className="space-y-1.5">
                      <span className="rx-label">{dict?.hub?.ownership ?? "Ownership"}</span>
                      <div className="flex flex-wrap gap-2">
                      {OWNERSHIP_VALUES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`rx-btn text-xs ${
                            mapFilters.ownership === value
                              ? "rx-btn-primary"
                              : ""
                          }`}
                          onClick={() =>
                            patchMapFilters({ ownership: value })
                          }
                        >
                          {ownershipLabel(value)}
                        </button>
                      ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="rx-label">{dict?.hub?.mode ?? "Mode"}</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={`rx-btn text-xs ${
                            mapFilters.mode === "all" ? "rx-btn-primary" : ""
                          }`}
                          onClick={() =>
                            patchMapFilters({ mode: "all" })
                          }
                        >
                          {HUB_MODE_LABELS.all}
                        </button>
                        {HUB_MODE_TAGS.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className={`rx-btn text-xs ${
                              mapFilters.mode === m ? "rx-btn-primary" : ""
                            }`}
                            onClick={() =>
                              patchMapFilters({
                                mode: m,
                                keys: m === "mania" ? mapFilters.keys : null,
                              })
                            }
                          >
                            {HUB_MODE_LABELS[m]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {showKeysFilter ? (
                      <div className="space-y-1.5">
                        <span className="rx-label">{dict?.hub?.keys ?? "Keys"}</span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={`rx-btn text-xs ${
                              mapFilters.keys == null ? "rx-btn-primary" : ""
                            }`}
                            onClick={() => patchMapFilters({ keys: null })}
                          >
                            {dict?.hub?.all ?? "All"}
                          </button>
                          {packKeys.map((k) => (
                            <button
                              key={k}
                              type="button"
                              className={`rx-btn text-xs ${
                                mapFilters.keys === k ? "rx-btn-primary" : ""
                              }`}
                              onClick={() => patchMapFilters({ keys: k })}
                            >
                              {k}K
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1 text-sm text-muted">
                        {dict?.hub?.minStars ?? "Min ★"}
                        <input
                          className="rx-input w-24"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.1}
                          value={mapFilters.minStars}
                          onChange={(e) =>
                            patchMapFilters({ minStars: e.target.value })
                          }
                          aria-label={dict?.hub?.minStarsAria ?? "Minimum star rating"}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-muted">
                        {dict?.hub?.maxStars ?? "Max ★"}
                        <input
                          className="rx-input w-24"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step={0.1}
                          value={mapFilters.maxStars}
                          onChange={(e) =>
                            patchMapFilters({ maxStars: e.target.value })
                          }
                          aria-label={dict?.hub?.maxStarsAria ?? "Maximum star rating"}
                        />
                      </label>
                      <button
                        type="button"
                        className="rx-btn text-xs"
                        onClick={() => setMapFilters(DEFAULT_MAP_FILTERS)}
                      >
                        {dict?.hub?.resetFilters ?? "Reset filters"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <p className="text-sm text-muted">
                  {t(dict?.hub?.showingOf ?? "Showing {{shown}} of {{total}}", {
                    shown: filteredMaps.length.toLocaleString(),
                    total: setIds.length.toLocaleString(),
                  })}
                  {mapFilters.ownership === "missing"
                    ? (dict?.hub?.notOwnedSuffix ?? " · not owned")
                    : mapFilters.ownership === "owned"
                      ? (dict?.hub?.ownedSuffix ?? " · owned")
                      : ""}
                </p>
              </section>

              {filteredMaps.length === 0 ? (
                <p className="text-muted">
                  {dict?.hub?.noMapsMatchFilters ?? "No maps match these filters. Try clearing search or ownership."}
                </p>
              ) : (
                <>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleMaps.map(({ setId, set, owned, mapName }) => (
                    <li key={setId}>
                      {set ? (
                        <OnlineSetCard set={set} owned={owned} />
                      ) : (
                        <PlaceholderSetCard
                          setId={setId}
                          mapName={mapName}
                          owned={owned}
                        />
                      )}
                    </li>
                  ))}
                </ul>
                {visibleMaps.length < filteredMaps.length ? (
                  <button
                    type="button"
                    className="rx-btn mt-4"
                    onClick={() => setMapPage((p) => p + 1)}
                  >
                    {dict?.hub?.loadMoreMaps ?? "Load more maps"}
                  </button>
                ) : null}
                </>
              )}
            </div>
          )}
        </>
      ) : null}

      <ConfirmModal
        open={saveOpen}
        title={updateAvailable
          ? (dict?.hub?.updateInGameTitle ?? "Update collection in game")
          : (dict?.hub?.saveCollection ?? "Save collection")}
        confirmLabel={updateAvailable
          ? (dict?.hub?.updateAndDownload ?? "Update & download")
          : (dict?.hub?.saveAndDownload ?? "Save & download")}
        busy={saveMut.isPending}
        onClose={() => {
          if (!saveMut.isPending) setSaveOpen(false);
        }}
        onConfirm={() => saveMut.mutate()}
      >
        <p>
          {t(dict?.hub?.confirmSaveBody ?? "This adds the pack to osu!lazer as !Roxysu {{name}}.", {
            name: c?.name ?? "…",
          })}
        </p>
        <p>
          {missingCount > 0
            ? t(dict?.hub?.missingMapsDownload ?? "{{count}} missing maps will be downloaded.", {
                count: missingCount.toLocaleString(),
              })
            : (dict?.hub?.ownEveryMap ?? "You already own every map in this collection.")}
        </p>
        {updateAvailable ? (
          <p className="text-warning/90">
            {dict?.hub?.creatorChanged ?? "The creator changed this collection since you last saved it."}
          </p>
        ) : null}
      </ConfirmModal>
      <ConfirmModal
        open={deleteOpen}
        title={dict?.hub?.deleteFromWorkshop ?? "Delete from Workshop"}
        confirmLabel={dict?.hub?.delete ?? "Delete"}
        busy={deleteMut.isPending}
        onClose={() => {
          if (!deleteMut.isPending) setDeleteOpen(false);
        }}
        onConfirm={() => deleteMut.mutate()}
      >
        <p>
          {t(dict?.hub?.deleteBody ?? "This removes {{name}} from Workshop. Anyone else will lose the public pack.", {
            name: c?.name ?? "this collection",
          })}
        </p>
        <p>{dict?.hub?.copyNotDeleted ?? "A copy already saved to your game is not deleted."}</p>
      </ConfirmModal>
    </div>
  );
}
