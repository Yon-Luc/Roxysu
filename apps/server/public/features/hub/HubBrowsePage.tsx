import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageTitle } from "../../components/PageTitle";
import { ListSkeleton } from "../../components/LoadingSkeleton";
import {
  HUB_TAGS,
  clearHubJwt,
  fetchHubCollections,
  fetchHubMe,
  useHubJwt,
  useHubUrl,
} from "../../lib/hub";
import { HubLoginButton } from "./HubLoginButton";

export function HubBrowsePage() {
  const hubUrl = useHubUrl();
  const queryClient = useQueryClient();
  const [tag, setTag] = useState<string>("");
  const [page, setPage] = useState(0);
  const jwt = useHubJwt();

  const meQuery = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    enabled: !!jwt,
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    retry: false,
  });

  const listQuery = useQuery({
    queryKey: ["hub-collections", hubUrl, tag, page, jwt],
    queryFn: () =>
      fetchHubCollections(hubUrl, {
        page,
        limit: 20,
        tag: tag || undefined,
        token: jwt,
      }),
  });

  const logout = useMutation({
    mutationFn: async () => {
      clearHubJwt();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hub-me"] });
      void queryClient.invalidateQueries({ queryKey: ["hub-collections"] });
    },
  });

  const totalPages = useMemo(() => {
    const total = listQuery.data?.total ?? 0;
    const limit = listQuery.data?.limit ?? 20;
    return Math.max(1, Math.ceil(total / limit));
  }, [listQuery.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle>Hub</PageTitle>
          <p className="rx-subtitle">
            Browse and download shared beatmap collections.
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
                    className="h-7 w-7 rounded-full"
                  />
                ) : null}
                <span className="text-ink">{meQuery.data.username}</span>
              </div>
              <button
                type="button"
                className="rx-btn"
                onClick={() => logout.mutate()}
              >
                Log out
              </button>
            </>
          ) : (
            <HubLoginButton />
          )}
          <Link to="/hub/share" className="rx-btn">
            Share collection
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rx-btn text-xs ${tag === "" ? "rx-btn-primary" : ""}`}
          onClick={() => {
            setTag("");
            setPage(0);
          }}
        >
          All
        </button>
        {HUB_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            className={`rx-btn text-xs ${tag === t ? "rx-btn-primary" : ""}`}
            onClick={() => {
              setTag(t);
              setPage(0);
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <ListSkeleton count={6} showThumbnail={false} />
      ) : listQuery.error ? (
        <p className="text-sm text-rose-300">{listQuery.error.message}</p>
      ) : !listQuery.data || listQuery.data.data.length === 0 ? (
        <p className="text-sm text-muted">No collections yet.</p>
      ) : (
        <ul className="space-y-2">
          {listQuery.data.data.map((c) => (
            <li key={c.id}>
              <Link
                to="/hub/$id"
                params={{ id: String(c.id) }}
                className="rx-row block justify-between transition hover:bg-surface/80"
              >
                <div className="min-w-0">
                  <div className="font-bold text-ink">{c.name}</div>
                  <div className="mt-0.5 truncate text-xs text-muted">
                    by {c.owner.username}
                    {c.description ? ` · ${c.description}` : ""}
                  </div>
                  {c.tags.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.tags.map((tagName) => (
                        <span
                          key={tagName}
                          className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-subtle"
                        >
                          {tagName}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right text-xs text-subtle">
                  <div>{c.mapCount.toLocaleString()} maps</div>
                  <div>{c.downloadCount.toLocaleString()} downloads</div>
                  <div>{c.favoriteCount.toLocaleString()} favorites</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {listQuery.data && listQuery.data.total > (listQuery.data.limit ?? 20) ? (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="rx-btn"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </button>
          <span className="text-sm text-muted">
            Page {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            className="rx-btn"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
