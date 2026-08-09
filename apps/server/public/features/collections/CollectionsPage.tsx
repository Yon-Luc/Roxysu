import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ListSkeleton,
  SkeletonBlock,
} from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { QueryLanguageHelpButton } from "../../components/QueryLanguageHelpModal";
import { useAppDict, t } from "../../lib/i18n";
import {
  createCollection,
  deleteCollection,
  fetchCollections,
  syncCollectionsToLazer,
  updateCollection,
  type RealmCollectionItem,
  type SmartCollectionItem,
} from "../../lib/api";

function formatSyncedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return null;
  }
}

export function CollectionsPage() {
  const { dict } = useAppDict();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editQuery, setEditQuery] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["collections"],
    queryFn: fetchCollections,
  });

  const smartItems = (data?.items ?? []).filter(
    (c): c is SmartCollectionItem => c.kind === "smart",
  );
  const realmItems = (data?.items ?? []).filter(
    (c): c is RealmCollectionItem => c.kind === "realm" && !c.managed,
  );

  const createMut = useMutation({
    mutationFn: createCollection,
    onSuccess: () => {
      setName("");
      setQuery("");
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const updateMut = useMutation({
    mutationFn: ({
      id,
      name: nextName,
      query: nextQuery,
    }: {
      id: number;
      name: string;
      query: string;
    }) => updateCollection(id, { name: nextName, query: nextQuery }),
    onSuccess: () => {
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteCollection,
    onMutate: (id) => {
      setDeletingId(id);
    },
    onSettled: () => {
      setDeletingId(null);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  const syncMut = useMutation({
    mutationFn: syncCollectionsToLazer,
    onSuccess: (result) => {
      setSyncMessage(
        t(dict?.collection.syncSuccess, {
          created: result.created,
          updated: result.updated,
          deleted: result.deleted,
        }) +
          (result.skippedNoMd5 > 0
            ? t(dict?.collection.syncSkipped, {
                count: result.skippedNoMd5,
              })
            : ""),
      );
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (err) => {
      setSyncMessage(err.message);
    },
  });

  function startEdit(c: SmartCollectionItem) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditQuery(c.query);
    updateMut.reset();
  }

  function cancelEdit() {
    setEditingId(null);
    updateMut.reset();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle>{dict?.nav.collections}</PageTitle>
          <p className="rx-subtitle">
            {dict?.collection.subtitle}{" "}
            <code className="text-subtle">stars:6..7 mapper:Lasse</code>
            {" · "}
            <QueryLanguageHelpButton />
          </p>
          <p className="mt-2 text-sm text-muted">
            {dict?.collection.closeLazer}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSyncMessage(null);
            syncMut.mutate();
          }}
          disabled={syncMut.isPending}
          className="rx-btn-primary shrink-0"
        >
          {syncMut.isPending
            ? dict?.collection.syncing
            : dict?.collection.syncToLazer}
        </button>
      </div>

      {syncMessage ? (
        <p
          className={
            syncMut.isError
              ? "text-sm text-rose-300"
              : "text-sm text-emerald-300/90"
          }
        >
          {syncMessage}
        </p>
      ) : null}

      <form
        className="grid gap-3 rounded-xl bg-surface p-4 sm:grid-cols-[1fr_2fr_auto] sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !query.trim() || createMut.isPending) return;
          createMut.mutate({ name: name.trim(), query: query.trim() });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={dict?.collection.namePlaceholder}
          className="rx-input"
          disabled={createMut.isPending}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={dict?.collection.queryPlaceholder}
          className="rx-input"
          disabled={createMut.isPending}
        />
        <button
          type="submit"
          disabled={createMut.isPending || !name.trim() || !query.trim()}
          className="rx-btn-primary"
        >
          {createMut.isPending
            ? dict?.collection.creating
            : dict?.collection.save}
        </button>
        {createMut.error ? (
          <p className="sm:col-span-3 text-sm text-rose-300">
            {createMut.error.message}
          </p>
        ) : null}
      </form>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 rounded-xl bg-surface p-4 sm:grid-cols-[1fr_2fr_auto] sm:p-5">
            <SkeletonBlock className="h-10 w-full rounded-md" />
            <SkeletonBlock className="h-10 w-full rounded-md" />
            <SkeletonBlock className="h-10 w-24 rounded-md" />
          </div>
          <ListSkeleton count={5} showThumbnail={false} />
        </div>
      ) : error ? (
        <p className="text-rose-300">{error.message}</p>
      ) : (
        <div className="space-y-8">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Smart collections
            </h2>
            {smartItems.length === 0 ? (
              <p className="text-sm text-muted">
                {dict?.collection.noCollections}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {smartItems.map((c) => {
                  const syncedLabel = formatSyncedAt(c.lazerSyncedAt);
                  const isEditing = editingId === c.id;
                  const isDeleting = deletingId === c.id;

                  if (isEditing) {
                    return (
                      <li key={`smart-${c.id}`}>
                        <form
                          className="rx-row flex-col gap-3 !items-stretch sm:flex-row sm:items-end"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (
                              !editName.trim() ||
                              !editQuery.trim() ||
                              updateMut.isPending
                            ) {
                              return;
                            }
                            updateMut.mutate({
                              id: c.id,
                              name: editName.trim(),
                              query: editQuery.trim(),
                            });
                          }}
                        >
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder={dict?.collection.namePlaceholder}
                            className="rx-input min-w-0 flex-1"
                            disabled={updateMut.isPending}
                          />
                          <input
                            value={editQuery}
                            onChange={(e) => setEditQuery(e.target.value)}
                            placeholder={dict?.collection.queryPlaceholder}
                            className="rx-input min-w-0 flex-[2] font-mono text-sm"
                            disabled={updateMut.isPending}
                          />
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="submit"
                              disabled={
                                updateMut.isPending ||
                                !editName.trim() ||
                                !editQuery.trim()
                              }
                              className="rx-btn-primary"
                            >
                              {updateMut.isPending
                                ? dict?.collection.updating
                                : dict?.collection.update}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={updateMut.isPending}
                              className="rx-btn"
                            >
                              {dict?.collection.cancel}
                            </button>
                          </div>
                          {updateMut.error ? (
                            <p className="text-sm text-rose-300 sm:col-span-3">
                              {updateMut.error.message}
                            </p>
                          ) : null}
                        </form>
                      </li>
                    );
                  }

                  return (
                    <li key={`smart-${c.id}`}>
                      <div
                        className={`rx-row justify-between transition-opacity ${isDeleting ? "opacity-50" : ""}`}
                      >
                        <div className="min-w-0">
                          <Link
                            to="/collections/$collectionId"
                            params={{ collectionId: String(c.id) }}
                            className="font-bold text-ink transition hover:underline"
                          >
                            {c.name}
                          </Link>
                          <div className="mt-0.5 truncate font-mono text-xs text-muted">
                            {c.query}
                          </div>
                          {syncedLabel ? (
                            <div className="mt-0.5 text-xs text-subtle">
                              {t(dict?.collection.syncedToLazer, {
                                time: syncedLabel,
                              })}
                            </div>
                          ) : null}
                          {isDeleting ? (
                            <div className="mt-0.5 text-xs text-muted">
                              {dict?.collection.deleting}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-sm font-semibold tabular-nums text-subtle">
                            {c.matchCount != null
                              ? t(dict?.collection.mapsCount, {
                                  count: c.matchCount.toLocaleString(),
                                })
                              : "—"}
                          </span>
                          <Link
                            to="/hub/share"
                            className="text-xs font-medium text-muted transition hover:text-ink"
                          >
                            Share
                          </Link>
                          <button
                            type="button"
                            onClick={() => startEdit(c)}
                            disabled={isDeleting || updateMut.isPending}
                            className="text-xs font-medium text-muted transition hover:text-ink"
                          >
                            {dict?.collection.edit}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMut.mutate(c.id)}
                            disabled={isDeleting || deleteMut.isPending}
                            className="text-xs font-medium text-rose-300/80 transition hover:text-rose-300 disabled:opacity-60"
                          >
                            {isDeleting
                              ? dict?.collection.deleting
                              : dict?.collection.delete}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {realmItems.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Lazer collections
              </h2>
              <ul className="space-y-0.5">
                {realmItems.map((c) => (
                  <li key={`realm-${c.id}`}>
                    <div className="rx-row justify-between">
                      <div className="min-w-0">
                        <div className="font-bold text-ink">{c.name}</div>
                        <div className="mt-0.5 text-xs text-muted">
                          {c.resolvedSetCount.toLocaleString()} /{" "}
                          {c.mapCount.toLocaleString()} sets resolved locally
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-semibold tabular-nums text-subtle">
                          {t(dict?.collection.mapsCount, {
                            count: c.mapCount.toLocaleString(),
                          })}
                        </span>
                        <Link
                          to="/hub/share"
                          className="text-xs font-medium text-muted transition hover:text-ink"
                        >
                          Share
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
