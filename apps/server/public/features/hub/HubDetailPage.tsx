import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmModal } from "../../components/ConfirmModal";
import { GoBackLink } from "../../components/GoBackLink";
import { OnlineSetCard } from "../../components/OnlineSetCard";
import { PageTitle } from "../../components/PageTitle";
import { CardGridSkeleton, ListSkeleton } from "../../components/LoadingSkeleton";
import {
  fetchBeatmapsetInfo,
  fetchHubAddedCollections,
  fetchOwnedSetIds,
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

const OWNERSHIP_OPTIONS: Array<{ value: MapOwnershipFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "missing", label: "Not owned" },
  { value: "owned", label: "Owned" },
];

const SORT_OPTIONS: Array<{ value: MapSort; label: string }> = [
  { value: "stars_desc", label: "Highest stars" },
  { value: "stars_asc", label: "Lowest stars" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "ranked_desc", label: "Newest ranked" },
  { value: "collection", label: "Collection order" },
];

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
  owned,
}: {
  setId: number;
  mapName: string;
  owned?: boolean;
}) {
  return (
    <div className="rx-card flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="truncate text-sm text-muted">Beatmapset</div>
        {owned ? (
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/90 text-ink"
            title="Already owned"
            aria-label="Already owned"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
              <path
                fillRule="evenodd"
                d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
        ) : null}
      </div>
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

  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState<HubTag[]>([]);
  const [editMode, setEditMode] = useState<HubModeTag | "all">("all");
  const [mapFilters, setMapFilters] =
    useState<HubCollectionMapFilterState>(DEFAULT_MAP_FILTERS);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);

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

  const ownership = ownedCountForSets(
    detailQuery.data?.beatmapsetIds?.length
      ? detailQuery.data.beatmapsetIds
      : setIds,
    ownedSetIds,
  );
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
      if (!jwt) throw new Error("Log in to favorite collections");
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
        title: "Favorite failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const editMut = useMutation({
    mutationFn: async () => {
      if (!jwt) throw new Error("Log in to edit");
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
      pushToast({ title: "Collection updated", tone: "success" });
    },
    onError: (err) =>
      pushToast({
        title: "Edit failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const c = detailQuery.data;
      if (!c) throw new Error("Collection not loaded");
      const beatmapsetIds =
        c.beatmapsetIds?.length > 0
          ? c.beatmapsetIds
          : c.maps.map((m) => m.beatmapsetId);
      if (!beatmapsetIds.length) throw new Error("Collection has no maps");

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
        title: updateAvailable ? "Collection updated in game" : "Collection saved",
        detail:
          saved.ownership.missingCount > 0
            ? `${saved.ownership.missingCount.toLocaleString()} missing maps are downloading. Synced as !Roxysu ${detailQuery.data?.name ?? ""}.`
            : `Synced to lazer as !Roxysu ${detailQuery.data?.name ?? ""}.`,
        tone: "success",
      });
    },
    onError: (err) =>
      pushToast({
        title: "Save failed",
        detail: err.message,
        tone: "error",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!jwt) throw new Error("Log in to delete");
      await deleteHubCollection(hubUrl, jwt, collectionId);
    },
    onSuccess: () => {
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
      void queryClient.invalidateQueries({ queryKey: ["hub-favorites"] });
      pushToast({
        title: "Collection deleted",
        detail: "Removed from Workshop. Your local copy is unchanged.",
        tone: "success",
      });
      void navigate({ to: "/hub" });
    },
    onError: (err) =>
      pushToast({
        title: "Delete failed",
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
    return filterAndSortCollectionMaps(rows, mapFilters);
  }, [setIds, nameById, byId, ownedSetIds, mapFilters]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <GoBackLink to="/hub">Workshop</GoBackLink>
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
          {canManage ? (
            <button
              type="button"
              className="rx-btn"
              disabled={!c}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "Cancel edit" : "Edit"}
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className="rx-btn"
              disabled={!c || deleteMut.isPending}
              onClick={() => setDeleteOpen(true)}
            >
              Delete
            </button>
          ) : null}
          {updateAvailable ? (
            <button
              type="button"
              className="rx-btn-primary"
              disabled={!c || saveMut.isPending}
              onClick={() => setSaveOpen(true)}
            >
              Update in game
            </button>
          ) : (
            <button
              type="button"
              className="rx-btn-primary"
              disabled={!c || saveMut.isPending}
              onClick={() => setSaveOpen(true)}
            >
              {isAdded ? "Re-save collection" : "Save collection"}
            </button>
          )}
        </div>
      </div>

      {detailQuery.isLoading ? (
        <ListSkeleton count={4} showThumbnail={false} />
      ) : detailQuery.error ? (
        <p className="text-sm text-rose-300">{detailQuery.error.message}</p>
      ) : c ? (
        <>
          {editing ? (
            <section className="rx-panel space-y-4 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-ink">Edit collection</h2>
              <label className="block space-y-1.5 text-sm">
                <span className="rx-label">Name</span>
                <input
                  className="rx-input w-full"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={100}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="rx-label">Description</span>
                <textarea
                  className="rx-textarea min-h-[5rem] w-full resize-y"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  maxLength={500}
                />
              </label>
              <div className="space-y-2">
                <span className="rx-label">Tags</span>
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
                  {editMut.isPending ? "Saving…" : "Save changes"}
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
              <span>{c.mapCount.toLocaleString()} maps</span>
            )}
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
            {isAdded ? (
              <span className="text-emerald-300/90">Saved to game</span>
            ) : null}
            {updateAvailable ? (
              <span className="text-amber-200">Creator updated this pack</span>
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
            <div className="space-y-4">
              <section className="rx-panel space-y-3 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted">
                    Search maps
                    <input
                      className="rx-input w-full"
                      value={mapFilters.q}
                      onChange={(e) => patchMapFilters({ q: e.target.value })}
                      placeholder="Title, artist, mapper, or set id"
                      aria-label="Search maps in collection"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-muted">
                    Sort
                    <select
                      className="rx-select"
                      value={mapFilters.sort}
                      onChange={(e) =>
                        patchMapFilters({ sort: e.target.value as MapSort })
                      }
                      aria-label="Sort maps"
                    >
                      {SORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
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
                    {moreFiltersOpen ? "Fewer filters" : "More filters"}
                    {advancedFiltersActive && !moreFiltersOpen ? " · on" : ""}
                  </button>
                </div>

                {moreFiltersOpen ? (
                  <div className="space-y-3 border-t border-white/10 pt-3">
                    <div className="space-y-1.5">
                      <span className="rx-label">Ownership</span>
                      <div className="flex flex-wrap gap-2">
                        {OWNERSHIP_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            className={`rx-btn text-xs ${
                              mapFilters.ownership === o.value
                                ? "rx-btn-primary"
                                : ""
                            }`}
                            onClick={() =>
                              patchMapFilters({ ownership: o.value })
                            }
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="rx-label">Mode</span>
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
                        <span className="rx-label">Keys</span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={`rx-btn text-xs ${
                              mapFilters.keys == null ? "rx-btn-primary" : ""
                            }`}
                            onClick={() => patchMapFilters({ keys: null })}
                          >
                            All
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
                        Min ★
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
                          aria-label="Minimum star rating"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-muted">
                        Max ★
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
                          aria-label="Maximum star rating"
                        />
                      </label>
                      <button
                        type="button"
                        className="rx-btn text-xs"
                        onClick={() => setMapFilters(DEFAULT_MAP_FILTERS)}
                      >
                        Reset filters
                      </button>
                    </div>
                  </div>
                ) : null}

                <p className="text-sm text-muted">
                  Showing {filteredMaps.length.toLocaleString()} of{" "}
                  {setIds.length.toLocaleString()}
                  {mapFilters.ownership === "missing"
                    ? " · not owned"
                    : mapFilters.ownership === "owned"
                      ? " · owned"
                      : ""}
                </p>
              </section>

              {filteredMaps.length === 0 ? (
                <p className="text-muted">
                  No maps match these filters. Try clearing search or ownership.
                </p>
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredMaps.map(({ setId, set, owned, mapName }) => (
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
              )}
            </div>
          )}
        </>
      ) : null}

      <ConfirmModal
        open={saveOpen}
        title={updateAvailable ? "Update collection in game" : "Save collection"}
        confirmLabel={updateAvailable ? "Update & download" : "Save & download"}
        busy={saveMut.isPending}
        onClose={() => {
          if (!saveMut.isPending) setSaveOpen(false);
        }}
        onConfirm={() => saveMut.mutate()}
      >
        <p>
          This adds the pack to osu!lazer as{" "}
          <span className="text-ink">!Roxysu {c?.name ?? "…"}</span>.
        </p>
        <p>
          {missingCount > 0
            ? `${missingCount.toLocaleString()} missing maps will be downloaded.`
            : "You already own every map in this collection."}
        </p>
        {updateAvailable ? (
          <p className="text-amber-200/90">
            The creator changed this collection since you last saved it.
          </p>
        ) : null}
      </ConfirmModal>
      <ConfirmModal
        open={deleteOpen}
        title="Delete from Workshop"
        confirmLabel="Delete"
        busy={deleteMut.isPending}
        onClose={() => {
          if (!deleteMut.isPending) setDeleteOpen(false);
        }}
        onConfirm={() => deleteMut.mutate()}
      >
        <p>
          This removes{" "}
          <span className="text-ink">{c?.name ?? "this collection"}</span> from
          Workshop. Anyone else will lose the public pack.
        </p>
        <p>A copy already saved to your game is not deleted.</p>
      </ConfirmModal>
    </div>
  );
}
