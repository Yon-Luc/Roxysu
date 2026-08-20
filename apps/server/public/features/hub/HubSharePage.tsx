import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BeatmapCover } from "../../components/BeatmapCover";
import { GoBackLink } from "../../components/GoBackLink";
import { ListSkeleton } from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import {
  fetchCollections,
  fetchRealmCollectionSetIds,
  fetchSmartCollectionSetIds,
  type RealmCollectionItem,
  type SmartCollectionItem,
} from "../../lib/api";
import {
  createHubCollection,
  fetchHubMe,
  useHubJwt,
  useHubUrl,
  type HubModeTag,
  type HubTag,
} from "../../lib/hub";
import { pushToast } from "../../lib/toasts";
import { useAppDict, t } from "../../lib/i18n";
import { HubLoginButton } from "./HubLoginButton";
import { HubTagFilters } from "./HubTagFilters";

const PREVIEW_SLOTS = 4;

type SourceKey =
  | { kind: "smart"; id: number }
  | { kind: "realm"; id: string }
  | null;

function SourceListCard({
  title,
  emptyLabel,
  loading,
  isEmpty,
  children,
}: {
  title: string;
  emptyLabel: string;
  loading: boolean;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rx-card flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-highlight/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <div className="max-h-56 overflow-auto p-2">
        {loading ? (
          <ListSkeleton count={4} showThumbnail={false} />
        ) : isEmpty ? (
          <p className="px-2 py-3 text-xs text-muted">{emptyLabel}</p>
        ) : (
          <ul className="space-y-1">{children}</ul>
        )}
      </div>
    </div>
  );
}

function SourceOption({
  selected,
  title,
  meta,
  onSelect,
}: {
  selected: boolean;
  title: string;
  meta?: string;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition ${
          selected
            ? "bg-ink/10 text-ink ring-1 ring-ink/15"
            : "text-muted hover:bg-elevated/50 hover:text-ink"
        }`}
        onClick={onSelect}
      >
        <span className="min-w-0 truncate text-sm font-medium">{title}</span>
        {meta ? (
          <span className="shrink-0 text-xs tabular-nums text-subtle">{meta}</span>
        ) : null}
      </button>
    </li>
  );
}

function CoverMosaic({ setIds }: { setIds: number[] }) {
  const previews = Array.from(
    { length: PREVIEW_SLOTS },
    (_, i) => setIds[i] ?? 0,
  );

  return (
    <div className="mx-auto grid h-20 w-full max-w-[14rem] grid-cols-4 overflow-hidden rounded-md sm:h-24 sm:max-w-[16rem]">
      {previews.map((setId, index) =>
        setId > 0 ? (
          <BeatmapCover
            key={`${setId}-${index}`}
            setOnlineId={setId}
            size="list"
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
  );
}

export function HubSharePage() {
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const navigate = useNavigate();
  const [source, setSource] = useState<SourceKey>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<HubTag[]>([]);
  const [tagMode, setTagMode] = useState<HubModeTag | "all">("all");
  const { dict } = useAppDict();

  const meQuery = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    enabled: !!jwt,
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    retry: false,
  });

  const collectionsQuery = useQuery({
    queryKey: ["collections"],
    queryFn: fetchCollections,
  });

  const smartItems = (collectionsQuery.data?.items ?? []).filter(
    (c): c is SmartCollectionItem => c.kind === "smart",
  );
  const realmItems = (collectionsQuery.data?.items ?? []).filter(
    (c): c is RealmCollectionItem => c.kind === "realm" && !c.managed,
  );

  const previewQuery = useQuery({
    queryKey: ["hub-share-preview", source],
    enabled: source != null,
    queryFn: async () => {
      if (!source) return null;
      if (source.kind === "smart") {
        return fetchSmartCollectionSetIds(source.id, { limit: 4 });
      }
      return fetchRealmCollectionSetIds(source.id, { limit: 4 });
    },
  });

  const beatmapsetIds = previewQuery.data?.beatmapsetIds ?? [];
  const previewTotal =
    previewQuery.data && "total" in previewQuery.data
      ? previewQuery.data.total
      : beatmapsetIds.length;
  const unresolved =
    previewQuery.data && "unresolvedHashCount" in previewQuery.data
      ? previewQuery.data.unresolvedHashCount
      : previewQuery.data && "unresolvedInternalSets" in previewQuery.data
        ? previewQuery.data.unresolvedInternalSets
        : 0;

  const canSubmit = useMemo(
    () =>
      !!jwt &&
      !!name.trim() &&
      previewTotal > 0 &&
      tags.length > 0,
    [jwt, name, previewTotal, tags.length],
  );

  const shareMut = useMutation({
    mutationFn: async () => {
      if (!jwt) throw new Error(dict?.hub?.loginFirstError ?? "Log in with osu! first");
      if (!name.trim()) throw new Error(dict?.hub?.nameRequiredError ?? "Name is required");
      if (!source) throw new Error(dict?.hub?.pickCollectionError ?? "Pick a collection");
      if (tags.length === 0) throw new Error(dict?.hub?.pickTagError ?? "Pick at least one tag");
      const full =
        source.kind === "smart"
          ? await fetchSmartCollectionSetIds(source.id)
          : await fetchRealmCollectionSetIds(source.id);
      if (full.beatmapsetIds.length === 0) throw new Error(dict?.hub?.noMapsToShareError ?? "No maps to share");
      return createHubCollection(hubUrl, jwt, {
        name: name.trim(),
        description: description.trim() || undefined,
        beatmapsetIds: full.beatmapsetIds,
        tags,
      });
    },
    onSuccess: (data) => {
      pushToast({
        title: dict?.hub?.sharedToWorkshop ?? "Shared to Community",
        detail: dict?.hub?.sharedDetail ?? "Your collection is now public.",
        tone: "success",
      });
      void navigate({ to: "/hub/$id", params: { id: String(data.id) } });
    },
    onError: (err) =>
      pushToast({
        title: dict?.hub?.shareFailed ?? "Share failed",
        detail: err.message,
        tone: "error",
      }),
  });

  function selectSmart(c: SmartCollectionItem) {
    setSource({ kind: "smart", id: c.id });
    if (!name.trim()) setName(c.name);
  }

  function selectRealm(c: RealmCollectionItem) {
    setSource({ kind: "realm", id: c.id });
    if (!name.trim()) setName(c.name);
  }

  const selectedLabel =
    source?.kind === "smart"
      ? smartItems.find((c) => c.id === source.id)?.name
      : source?.kind === "realm"
        ? realmItems.find((c) => c.id === source.id)?.name
        : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <GoBackLink to="/hub">{dict?.hub?.workshop ?? "Community"}</GoBackLink>
          <PageTitle>{dict?.hub?.shareCollectionTitle ?? "Share collection"}</PageTitle>
          <p className="rx-subtitle">
            {dict?.hub?.shareSubtitle ?? "Upload a local smart or lazer collection to the Community."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {meQuery.data ? (
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
          ) : (
            <HubLoginButton />
          )}
          <button
            type="button"
            className="rx-btn-primary"
            disabled={!canSubmit || shareMut.isPending}
            onClick={() => shareMut.mutate()}
          >
            {shareMut.isPending
              ? (dict?.hub?.sharing ?? "Sharing…")
              : (dict?.hub?.shareToWorkshop ?? "Share to Community")}
          </button>
        </div>
      </div>

      {!jwt ? (
        <div className="rx-card p-5">
          <div className="font-semibold text-ink">{dict?.hub?.signInRequired ?? "Sign in required"}</div>
          <p className="mt-1 text-sm text-muted">
            {dict?.hub?.loginToPublish ?? "Log in with osu! to publish a collection to the Community."}
          </p>
          <HubLoginButton className="rx-btn-primary mt-4 inline-flex" />
        </div>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{dict?.hub?.source ?? "Source"}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {dict?.hub?.pickSource ?? "Pick a local collection to upload."}
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <SourceListCard
            title={dict?.hub?.smart ?? "Smart"}
            emptyLabel={dict?.hub?.noSmartCollections ?? "No smart collections yet."}
            loading={collectionsQuery.isLoading}
            isEmpty={smartItems.length === 0}
          >
            {smartItems.map((c) => (
              <SourceOption
                key={`smart-${c.id}`}
                selected={source?.kind === "smart" && source.id === c.id}
                title={c.name}
                onSelect={() => selectSmart(c)}
              />
            ))}
          </SourceListCard>
          <SourceListCard
            title={dict?.hub?.lazer ?? "Lazer"}
            emptyLabel={dict?.hub?.noLazerCollections ?? "No lazer collections synced yet."}
            loading={collectionsQuery.isLoading}
            isEmpty={realmItems.length === 0}
          >
            {realmItems.map((c) => (
              <SourceOption
                key={`realm-${c.id}`}
                selected={source?.kind === "realm" && source.id === c.id}
                title={c.name}
                meta={`${c.resolvedSetCount}/${c.mapCount}`}
                onSelect={() => selectRealm(c)}
              />
            ))}
          </SourceListCard>
        </div>
      </section>

      {source ? (
        <section className="rx-card overflow-hidden">
          <div className="flex justify-center px-4 pt-4">
            {previewQuery.isLoading ? (
              <div className="h-20 w-full max-w-[14rem] animate-pulse rounded-md bg-highlight/80 sm:h-24 sm:max-w-[16rem]" />
            ) : (
              <CoverMosaic setIds={beatmapsetIds} />
            )}
          </div>
          <div className="p-4">
              <div className="truncate font-bold text-ink">
                {selectedLabel ?? (dict?.hub?.selectedCollection ?? "Selected collection")}
              </div>
              <div className="mt-1 text-sm text-muted">
                {previewQuery.isLoading
                  ? (dict?.hub?.resolvingMaps ?? "Resolving maps…")
                  : previewQuery.error
                    ? previewQuery.error.message
                    : `${t(dict?.hub?.beatmapsetsReady ?? "{{count}} beatmapsets ready", { count: previewTotal.toLocaleString() })}${
                        unresolved > 0
                          ? t(dict?.hub?.unresolvedLocally ?? " · {{count}} unresolved locally", { count: unresolved.toLocaleString() })
                          : ""
                      }`}
              </div>
            {tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-subtle"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rx-panel space-y-4 p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold text-ink">{dict?.hub?.details ?? "Details"}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {dict?.hub?.detailsSubtitle ?? "How this collection appears in the Community."}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="rx-label">{dict?.hub?.name ?? "Name"}</span>
            <input
              className="rx-input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder={dict?.hub?.collectionNamePlaceholder ?? "Collection name"}
            />
          </label>
          <label className="space-y-1.5 text-sm sm:col-span-2">
            <span className="rx-label">{dict?.hub?.description ?? "Description"}</span>
            <textarea
              className="rx-textarea min-h-[5.5rem] w-full resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder={dict?.hub?.descriptionPlaceholder ?? "Optional short description"}
            />
          </label>
        </div>

        <div className="space-y-2">
          <div>
            <span className="rx-label">{dict?.hub?.tags ?? "Tags"}</span>
            <p className="mt-0.5 text-xs text-muted">
              {dict?.hub?.tagsHint ?? "Pick a gamemode, then add pattern tags (required)."}
            </p>
          </div>
          <HubTagFilters
            mode={tagMode}
            tags={tags}
            onModeChange={setTagMode}
            onTagsChange={setTags}
            selectModeAsTag
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {!jwt
            ? (dict?.hub?.loginToShare ?? "Log in to share.")
            : !source
              ? (dict?.hub?.selectSource ?? "Select a source collection.")
              : beatmapsetIds.length === 0 && !previewQuery.isLoading
                ? (dict?.hub?.noResolvableMaps ?? "Selected collection has no resolvable maps.")
                : tags.length === 0
                  ? (dict?.hub?.pickTag ?? "Pick at least one tag.")
                  : !name.trim()
                    ? (dict?.hub?.addName ?? "Add a name.")
                    : (dict?.hub?.readyToPublish ?? "Ready to publish.")}
        </p>
        <button
          type="button"
          className="rx-btn-primary"
          disabled={!canSubmit || shareMut.isPending}
          onClick={() => shareMut.mutate()}
        >
          {shareMut.isPending
            ? (dict?.hub?.sharing ?? "Sharing…")
              : (dict?.hub?.shareToWorkshop ?? "Share to Community")}
        </button>
      </div>
    </div>
  );
}
