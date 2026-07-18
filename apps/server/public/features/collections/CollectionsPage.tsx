import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Collections
        </h1>
        <p className="mt-1 text-sm text-[#8b93a7]">
          Smart collections store query strings — e.g.{" "}
          <code className="text-[#a8b0c0]">stars:6..7 mapper:Lasse</code>
        </p>
      </div>

      <form
        className="grid gap-3 rounded-lg border border-white/10 bg-[#151922] p-4 sm:grid-cols-[1fr_2fr_auto]"
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
          className="rounded-md border border-white/10 bg-[#0e1015] px-3 py-2 text-sm text-white outline-none focus:border-white/25"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Query"
          className="rounded-md border border-white/10 bg-[#0e1015] px-3 py-2 text-sm text-white outline-none focus:border-white/25"
        />
        <button
          type="submit"
          disabled={createMut.isPending}
          className="rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
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
        <p className="text-[#8b93a7]">Loading…</p>
      ) : error ? (
        <p className="text-rose-300">{error.message}</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-[#8b93a7]">No collections yet.</p>
      ) : (
        <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 bg-[#151922]">
          {data.items.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <Link
                  to="/collections/$collectionId"
                  params={{ collectionId: String(c.id) }}
                  className="font-medium text-white hover:underline"
                >
                  {c.name}
                </Link>
                <div className="mt-0.5 truncate font-mono text-xs text-[#8b93a7]">
                  {c.query}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-[#a8b0c0]">
                  {c.matchCount != null
                    ? `${c.matchCount.toLocaleString()} maps`
                    : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => deleteMut.mutate(c.id)}
                  className="text-xs text-rose-300/80 hover:text-rose-300"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
