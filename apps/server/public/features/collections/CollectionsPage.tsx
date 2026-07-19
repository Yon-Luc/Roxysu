import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { QueryLanguageHelpButton } from "../../components/QueryLanguageHelpModal";
import {
  createCollection,
  deleteCollection,
  fetchCollections,
} from "../../lib/api";

export function CollectionsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");

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

  const deleteMut = useMutation({
    mutationFn: deleteCollection,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <PageTitle>Collections</PageTitle>
        <p className="rx-subtitle">
          Smart collections store query strings — e.g.{" "}
          <code className="text-subtle">stars:6..7 mapper:Lasse</code>
          {" · "}
          <QueryLanguageHelpButton />
        </p>
      </div>

      <form
        className="grid gap-3 rounded-xl bg-surface p-4 sm:grid-cols-[1fr_2fr_auto] sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !query.trim()) return;
          createMut.mutate({ name: name.trim(), query: query.trim() });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="rx-input"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Query"
          className="rx-input"
        />
        <button
          type="submit"
          disabled={createMut.isPending}
          className="rx-btn-primary"
        >
          Save
        </button>
        {createMut.error ? (
          <p className="sm:col-span-3 text-sm text-rose-300">
            {createMut.error.message}
          </p>
        ) : null}
      </form>

      {isLoading ? (
        <p className="text-muted">Loading…</p>
      ) : error ? (
        <p className="text-rose-300">{error.message}</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-muted">No collections yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {data.items.map((c) => (
            <li key={c.id}>
              <div className="rx-row justify-between">
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
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums text-subtle">
                    {c.matchCount != null
                      ? `${c.matchCount.toLocaleString()} maps`
                      : "—"}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteMut.mutate(c.id)}
                    className="text-xs font-medium text-rose-300/80 transition hover:text-rose-300"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
