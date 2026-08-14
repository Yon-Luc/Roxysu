import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GoBackLink } from "../../components/GoBackLink";
import { ListSkeleton } from "../../components/LoadingSkeleton";
import { PageTitle } from "../../components/PageTitle";
import { formatRelativeTime } from "../../lib/format";
import {
  createHubAdminCache,
  deleteHubAdminCache,
  fetchHubAdminCache,
  fetchHubMe,
  patchHubAdminCache,
  refreshHubAdminCache,
  useHubJwt,
  useHubUrl,
  type HubSearchCacheEntry,
} from "../../lib/hub";
import { pushToast } from "../../lib/toasts";
import { HubLoginButton } from "./HubLoginButton";

const FREQUENCY_OPTIONS: Array<{ label: string; minutes: number | null }> = [
  { label: "Off (manual)", minutes: null },
  { label: "Every 1 hour", minutes: 60 },
  { label: "Every 6 hours", minutes: 360 },
  { label: "Every 12 hours", minutes: 720 },
  { label: "Every 24 hours", minutes: 1440 },
];

const MODE_OPTIONS = [
  { label: "osu!", value: 0 },
  { label: "Taiko", value: 1 },
  { label: "Catch", value: 2 },
  { label: "Mania", value: 3 },
] as const;

const STATUS_OPTIONS = [
  "ranked",
  "loved",
  "pending",
  "qualified",
  "graveyard",
  "any",
] as const;

function frequencyLabel(minutes: number | null): string {
  const match = FREQUENCY_OPTIONS.find((o) => o.minutes === minutes);
  return match?.label ?? (minutes == null ? "Off" : `Every ${minutes}m`);
}

function paramsSummary(params: HubSearchCacheEntry["queryParams"]): string {
  const parts: string[] = [];
  if (params.mode != null) {
    const mode = MODE_OPTIONS.find((m) => m.value === Number(params.mode));
    parts.push(mode?.label ?? `mode=${params.mode}`);
  }
  if (params.status) parts.push(String(params.status));
  if (params.key != null) parts.push(`${params.key}K`);
  if (params.query) parts.push(`“${params.query}”`);
  return parts.join(" · ") || "(empty)";
}

export function HubAdminCachePage() {
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("Ranked 7K");
  const [mode, setMode] = useState(3);
  const [status, setStatus] = useState<string>("ranked");
  const [key, setKey] = useState("7");
  const [frequency, setFrequency] = useState<number | null>(360);

  const meQuery = useQuery({
    queryKey: ["hub-me", hubUrl, jwt],
    enabled: !!jwt,
    queryFn: () => fetchHubMe(hubUrl, jwt!),
    retry: false,
  });

  const isAdmin = meQuery.data?.role === "admin";

  const listQuery = useQuery({
    queryKey: ["hub-admin-cache", hubUrl, jwt],
    enabled: !!jwt && isAdmin,
    queryFn: () => fetchHubAdminCache(hubUrl, jwt!),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["hub-admin-cache"] });
  };

  const createMut = useMutation({
    mutationFn: () => {
      const keyNum = Number(key);
      return createHubAdminCache(hubUrl, jwt!, {
        label: label.trim() || undefined,
        refreshIntervalMinutes: frequency,
        query_params: {
          mode,
          status: status === "any" ? undefined : status,
          ...(Number.isSafeInteger(keyNum) && keyNum > 0
            ? { key: keyNum }
            : {}),
        },
      });
    },
    onSuccess: (data) => {
      pushToast({
        title: `Primed “${label.trim() || "cache"}”`,
        detail: `${data.totalCount} sets`,
        tone: "success",
      });
      invalidate();
    },
    onError: (err: Error) => {
      pushToast({ title: "Create failed", detail: err.message, tone: "error" });
    },
  });

  const refreshMut = useMutation({
    mutationFn: (id: number) => refreshHubAdminCache(hubUrl, jwt!, id),
    onSuccess: (data) => {
      pushToast({
        title: "Cache refreshed",
        detail: `${data.totalCount} sets`,
        tone: "success",
      });
      invalidate();
    },
    onError: (err: Error) => {
      pushToast({ title: "Refresh failed", detail: err.message, tone: "error" });
    },
  });

  const patchMut = useMutation({
    mutationFn: (args: {
      id: number;
      refreshIntervalMinutes: number | null;
    }) =>
      patchHubAdminCache(hubUrl, jwt!, args.id, {
        refreshIntervalMinutes: args.refreshIntervalMinutes,
      }),
    onSuccess: () => {
      pushToast({ title: "Frequency updated", tone: "success" });
      invalidate();
    },
    onError: (err: Error) => {
      pushToast({ title: "Update failed", detail: err.message, tone: "error" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteHubAdminCache(hubUrl, jwt!, id),
    onSuccess: () => {
      pushToast({ title: "Cache entry deleted", tone: "success" });
      invalidate();
    },
    onError: (err: Error) => {
      pushToast({ title: "Delete failed", detail: err.message, tone: "error" });
    },
  });

  const entries = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  if (!jwt) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <PageTitle>Search cache</PageTitle>
          <p className="rx-subtitle">Admin</p>
        </div>
        <p className="text-sm text-muted">Log in to manage Download search caches.</p>
        <HubLoginButton />
      </div>
    );
  }

  if (meQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <PageTitle>Search cache</PageTitle>
          <p className="rx-subtitle">Admin</p>
        </div>
        <ListSkeleton count={3} showThumbnail={false} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <GoBackLink to="/hub">Workshop</GoBackLink>
          <PageTitle className="mt-3">Search cache</PageTitle>
          <p className="rx-subtitle">Admin</p>
        </div>
        <p className="text-sm text-danger">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <GoBackLink to="/hub">Workshop</GoBackLink>
        <PageTitle className="mt-3">Search cache</PageTitle>
        <p className="rx-subtitle">
          Prime Download quick-search indexes (keymode-aware)
        </p>
      </div>

      <form
        className="rx-card flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          createMut.mutate();
        }}
      >
        <h2 className="text-sm font-semibold text-ink">Create cache</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Label
            <input
              className="rx-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Mode
            <select
              className="rx-input"
              value={mode}
              onChange={(e) => setMode(Number(e.target.value))}
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Status
            <select
              className="rx-input"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Keys (mania)
            <input
              className="rx-input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. 7"
              inputMode="numeric"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Frequency check for new beatmaps
            <select
              className="rx-input"
              value={frequency == null ? "" : String(frequency)}
              onChange={(e) => {
                const v = e.target.value;
                setFrequency(v === "" ? null : Number(v));
              }}
            >
              {FREQUENCY_OPTIONS.map((o) => (
                <option
                  key={o.label}
                  value={o.minutes == null ? "" : String(o.minutes)}
                >
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="rx-btn rx-btn-primary w-fit"
          disabled={createMut.isPending}
        >
          {createMut.isPending ? "Priming…" : "Create & prime"}
        </button>
      </form>

      {listQuery.isLoading ? (
        <ListSkeleton count={4} showThumbnail={false} />
      ) : listQuery.error ? (
        <p className="text-sm text-danger">{listQuery.error.message}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">No cache entries yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rx-card flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-ink">
                    {entry.label || `Cache #${entry.id}`}
                  </h3>
                  <p className="text-xs text-muted">
                    {paramsSummary(entry.queryParams)} · {entry.totalCount} sets
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {entry.stale ? (
                    <span className="rounded bg-warning/20 px-2 py-0.5 text-warning">
                      Stale
                    </span>
                  ) : (
                    <span className="rounded bg-success/15 px-2 py-0.5 text-success">
                      Fresh
                    </span>
                  )}
                  {entry.refreshError ? (
                    <span className="rounded bg-danger/20 px-2 py-0.5 text-danger">
                      Error
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                <span>
                  Last refresh:{" "}
                  {entry.lastRefreshAt
                    ? formatRelativeTime(entry.lastRefreshAt)
                    : "never"}
                </span>
                <span>
                  Frequency: {frequencyLabel(entry.refreshIntervalMinutes)}
                  {entry.nextRefreshAt
                    ? ` · next ${formatRelativeTime(entry.nextRefreshAt)}`
                    : ""}
                </span>
                {entry.refreshError ? (
                  <span className="text-danger sm:col-span-2">
                    {entry.refreshError}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-muted">
                  Frequency
                  <select
                    className="rx-input py-1 text-xs"
                    value={
                      entry.refreshIntervalMinutes == null
                        ? ""
                        : String(entry.refreshIntervalMinutes)
                    }
                    disabled={patchMut.isPending}
                    onChange={(e) => {
                      const v = e.target.value;
                      patchMut.mutate({
                        id: entry.id,
                        refreshIntervalMinutes: v === "" ? null : Number(v),
                      });
                    }}
                  >
                    {FREQUENCY_OPTIONS.map((o) => (
                      <option
                        key={o.label}
                        value={o.minutes == null ? "" : String(o.minutes)}
                      >
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="rx-btn text-sm"
                  disabled={refreshMut.isPending}
                  onClick={() => refreshMut.mutate(entry.id)}
                >
                  Refresh now
                </button>
                <button
                  type="button"
                  className="rx-btn text-sm text-danger"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete cache “${entry.label || entry.id}”?`,
                      )
                    ) {
                      deleteMut.mutate(entry.id);
                    }
                  }}
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
