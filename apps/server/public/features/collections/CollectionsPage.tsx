import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ListSkeleton,
  SkeletonBlock,
} from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { QueryLanguageHelpButton } from "../../components/QueryLanguageHelpModal";
import {
  createCollection,
  deleteCollection,
  fetchCollections,
  syncCollectionsToLazer,
  updateCollection,
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
        `Synced to osu!lazer — ${result.created} created, ${result.updated} updated, ${result.deleted} removed` +
          (result.skippedNoMd5 > 0
            ? ` (${result.skippedNoMd5} maps skipped — no MD5 hash)`
            : ""),
      );
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (err) => {
      setSyncMessage(err.message);
    },
  });

  function startEdit(c: { id: number; name: string; query: string }) {
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
          <PageTitle>Collections</PageTitle>
          <p className="rx-subtitle">
            Smart collections store query strings — e.g.{" "}
            <code className="text-subtle">stars:6..7 mapper:Lasse</code>
            {" · "}
            <QueryLanguageHelpButton />
          </p>
          <p className="mt-2 text-sm text-muted">
            Close osu!lazer first. Sync writes collections prefixed with{" "}
            <code className="text-subtle">!Roxysu</code> and backs up{" "}
            <code className="text-subtle">client.realm</code> before editing.
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
          {syncMut.isPending ? "Syncing…" : "Sync to osu!lazer"}
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
          placeholder="Name"
          className="rx-input"
          disabled={createMut.isPending}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Query"
          className="rx-input"
          disabled={createMut.isPending}
        />
        <button
          type="submit"
          disabled={createMut.isPending || !name.trim() || !query.trim()}
          className="rx-btn-primary"
        >
          {createMut.isPending ? "Creating…" : "Save"}
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
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-muted">No collections yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {data.items.map((c) => {
            const syncedLabel = formatSyncedAt(c.lazerSyncedAt);
            const isEditing = editingId === c.id;
            const isDeleting = deletingId === c.id;

            if (isEditing) {
              return (
                <li key={c.id}>
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
                      placeholder="Name"
                      className="rx-input min-w-0 flex-1"
                      disabled={updateMut.isPending}
                    />
                    <input
                      value={editQuery}
                      onChange={(e) => setEditQuery(e.target.value)}
                      placeholder="Query"
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
                        {updateMut.isPending ? "Updating…" : "Update"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={updateMut.isPending}
                        className="rx-btn"
                      >
                        Cancel
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
              <li key={c.id}>
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
                        Synced to lazer {syncedLabel}
                      </div>
                    ) : null}
                    {isDeleting ? (
                      <div className="mt-0.5 text-xs text-muted">Deleting…</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums text-subtle">
                      {c.matchCount != null
                        ? `${c.matchCount.toLocaleString()} maps`
                        : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      disabled={isDeleting || updateMut.isPending}
                      className="text-xs font-medium text-muted transition hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMut.mutate(c.id)}
                      disabled={isDeleting || deleteMut.isPending}
                      className="text-xs font-medium text-rose-300/80 transition hover:text-rose-300 disabled:opacity-60"
                    >
                      {isDeleting ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
