import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import {
  fetchCollections,
  fetchRealmCollectionSetIds,
  fetchSmartCollectionSetIds,
  type RealmCollectionItem,
  type SmartCollectionItem,
} from "../../lib/api";
import {
  HUB_TAGS,
  createHubCollection,
  useHubJwt,
  useHubUrl,
  type HubTag,
} from "../../lib/hub";
import { pushToast } from "../../lib/toasts";
import { HubLoginButton } from "./HubLoginButton";

type SourceKey =
  | { kind: "smart"; id: number }
  | { kind: "realm"; id: string }
  | null;

export function HubSharePage() {
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const navigate = useNavigate();
  const [source, setSource] = useState<SourceKey>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<HubTag[]>([]);

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
        return fetchSmartCollectionSetIds(source.id);
      }
      return fetchRealmCollectionSetIds(source.id);
    },
  });

  const beatmapsetIds = previewQuery.data?.beatmapsetIds ?? [];
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
      beatmapsetIds.length > 0 &&
      tags.length > 0,
    [jwt, name, beatmapsetIds.length, tags.length],
  );

  const shareMut = useMutation({
    mutationFn: async () => {
      if (!jwt) throw new Error("Log in with osu! first");
      if (!name.trim()) throw new Error("Name is required");
      if (beatmapsetIds.length === 0) throw new Error("No maps to share");
      if (tags.length === 0) throw new Error("Pick at least one tag");
      return createHubCollection(hubUrl, jwt, {
        name: name.trim(),
        description: description.trim() || undefined,
        beatmapsetIds,
        tags,
      });
    },
    onSuccess: (data) => {
      pushToast({
        title: "Shared to hub",
        detail: "Your collection is now public.",
        tone: "success",
      });
      void navigate({ to: "/hub/$id", params: { id: String(data.id) } });
    },
    onError: (err) =>
      pushToast({
        title: "Share failed",
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

  function toggleTag(tag: HubTag) {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/hub" className="text-xs text-muted hover:text-ink">
          ← Hub
        </Link>
        <PageTitle>Share collection</PageTitle>
        <p className="rx-subtitle">
          Upload a local smart or lazer collection to the public hub.
        </p>
      </div>

      {!jwt ? (
        <div className="rounded-xl bg-surface p-4">
          <p className="text-sm text-muted">
            Sign in with osu! to share collections.
          </p>
          <HubLoginButton className="rx-btn-primary mt-3 inline-flex" />
        </div>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Source
        </h2>
        {collectionsQuery.isLoading ? (
          <p className="text-sm text-muted">Loading local collections…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1">
              <h3 className="text-xs text-subtle">Smart</h3>
              <ul className="max-h-48 space-y-1 overflow-auto rounded-xl bg-surface p-2">
                {smartItems.map((c) => {
                  const selected =
                    source?.kind === "smart" && source.id === c.id;
                  return (
                    <li key={`smart-${c.id}`}>
                      <button
                        type="button"
                        className={`w-full rounded px-2 py-1.5 text-left text-sm ${selected ? "bg-ink/10 text-ink" : "text-muted hover:text-ink"}`}
                        onClick={() => selectSmart(c)}
                      >
                        {c.name}
                      </button>
                    </li>
                  );
                })}
                {smartItems.length === 0 ? (
                  <li className="px-2 py-1 text-xs text-muted">None</li>
                ) : null}
              </ul>
            </div>
            <div className="space-y-1">
              <h3 className="text-xs text-subtle">Lazer</h3>
              <ul className="max-h-48 space-y-1 overflow-auto rounded-xl bg-surface p-2">
                {realmItems.map((c) => {
                  const selected =
                    source?.kind === "realm" && source.id === c.id;
                  return (
                    <li key={`realm-${c.id}`}>
                      <button
                        type="button"
                        className={`w-full rounded px-2 py-1.5 text-left text-sm ${selected ? "bg-ink/10 text-ink" : "text-muted hover:text-ink"}`}
                        onClick={() => selectRealm(c)}
                      >
                        {c.name}
                        <span className="ml-2 text-xs text-subtle">
                          {c.resolvedSetCount}/{c.mapCount}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {realmItems.length === 0 ? (
                  <li className="px-2 py-1 text-xs text-muted">None</li>
                ) : null}
              </ul>
            </div>
          </div>
        )}
        {source ? (
          <p className="text-sm text-muted">
            {previewQuery.isLoading
              ? "Resolving maps…"
              : previewQuery.error
                ? previewQuery.error.message
                : `${beatmapsetIds.length.toLocaleString()} beatmapsets ready${unresolved > 0 ? ` · ${unresolved} unresolved locally` : ""}`}
          </p>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Name</span>
          <input
            className="rx-input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-muted">Description</span>
          <input
            className="rx-input w-full"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
        </label>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Tags
        </h2>
        <div className="flex flex-wrap gap-2">
          {HUB_TAGS.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`rx-btn text-xs ${on ? "rx-btn-primary" : ""}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        className="rx-btn-primary"
        disabled={!canSubmit || shareMut.isPending}
        onClick={() => shareMut.mutate()}
      >
        {shareMut.isPending ? "Sharing…" : "Share to hub"}
      </button>
    </div>
  );
}
