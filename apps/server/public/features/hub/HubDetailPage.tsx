import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmModal } from "../../components/ConfirmModal";
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
  useHubJwt,
  useHubUrl,
  type HubModeTag,
  type HubTag,
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
import { HubLoginButton } from "./HubLoginButton";
import { HubTagFilters } from "./HubTagFilters";

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

  const [saveOpen, setSaveOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState<HubTag[]>([]);
  const [editMode, setEditMode] = useState<HubModeTag | "all">("all");

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
          {isOwner ? (
            <button
              type="button"
              className="rx-btn"
              disabled={!c}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "Cancel edit" : "Edit"}
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
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {setIds.map((setId) => {
                const set = byId.get(setId);
                const owned = ownedSetIds.has(setId);
                return (
                  <li key={setId}>
                    {set ? (
                      <OnlineSetCard set={set} owned={owned} />
                    ) : (
                      <PlaceholderSetCard
                        setId={setId}
                        mapName={nameById.get(setId) ?? ""}
                        owned={owned}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
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
    </div>
  );
}
