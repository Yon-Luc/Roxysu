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
import { useAppDict, t } from "../../lib/i18n";
import type { Dictionary } from "@roxysu/i18n";
import { HubLoginButton } from "./HubLoginButton";

type AppDict = Dictionary["app"];

const FREQUENCY_OPTIONS: Array<{ key: string; fallback: string; minutes: number | null }> = [
  { key: "adminFreqOffManual", fallback: "Off (manual)", minutes: null },
  { key: "adminFreqHour1", fallback: "Every 1 hour", minutes: 60 },
  { key: "adminFreqHour6", fallback: "Every 6 hours", minutes: 360 },
  { key: "adminFreqHour12", fallback: "Every 12 hours", minutes: 720 },
  { key: "adminFreqHour24", fallback: "Every 24 hours", minutes: 1440 },
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

const SORT_OPTIONS = [
  { value: "ranked_desc", key: "adminSortRankedDesc", fallback: "Recently ranked" },
  { value: "plays_desc", key: "adminSortPlaysDesc", fallback: "Most played" },
  { value: "favourites_desc", key: "adminSortFavouritesDesc", fallback: "Most favourited" },
  { value: "difficulty_desc", key: "adminSortDifficultyDesc", fallback: "Hardest" },
  { value: "title_asc", key: "adminSortTitleAsc", fallback: "Title A–Z" },
  { value: "ranked_asc", key: "adminSortRankedAsc", fallback: "Oldest ranked" },
] as const;

function hubStr(dict: AppDict | undefined, key: string): string | undefined {
  return (dict?.hub as Record<string, string | undefined> | undefined)?.[key];
}

function frequencyLabel(dict: AppDict | undefined, minutes: number | null): string {
  if (minutes == null) return hubStr(dict, "adminFreqOff") ?? "Off";
  const match = FREQUENCY_OPTIONS.find((o) => o.minutes === minutes);
  return match ? (hubStr(dict, match.key) ?? match.fallback) : `Every ${minutes}m`;
}

function paramsSummary(dict: AppDict | undefined, params: HubSearchCacheEntry["queryParams"]): string {
  const parts: string[] = [];
  if (params.mode != null) {
    const mode = MODE_OPTIONS.find((m) => m.value === Number(params.mode));
    parts.push(mode?.label ?? `mode=${params.mode}`);
  }
  if (params.status) parts.push(String(params.status));
  if (params.key != null) parts.push(`${params.key}K`);
  if (params.sort) {
    const sort = SORT_OPTIONS.find((s) => s.value === String(params.sort));
    parts.push(sort ? (hubStr(dict, sort.key) ?? sort.fallback) : String(params.sort));
  }
  return parts.join(" · ") || (hubStr(dict, "adminEmpty") ?? "(empty)");
}

export function HubAdminCachePage() {
  const hubUrl = useHubUrl();
  const jwt = useHubJwt();
  const queryClient = useQueryClient();
  const { dict } = useAppDict();

  const [label, setLabel] = useState("Ranked 7K");
  const [mode, setMode] = useState(3);
  const [status, setStatus] = useState<string>("ranked");
  const [key, setKey] = useState("7");
  const [sort, setSort] = useState<string>("ranked_desc");
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
          sort: sort || undefined,
          ...(Number.isSafeInteger(keyNum) && keyNum > 0
            ? { key: keyNum }
            : {}),
        },
      });
    },
    onSuccess: (data) => {
      pushToast({
        title: t(dict?.hub?.adminPrimedTitle ?? "Primed “{{label}}”", {
          label: label.trim() || "cache",
        }),
        detail: t(dict?.hub?.adminSetsCount ?? "{{count}} sets", {
          count: data.totalCount.toLocaleString(),
        }),
        tone: "success",
      });
      invalidate();
    },
    onError: (err: Error) => {
      pushToast({ title: dict?.hub?.adminCreateFailed ?? "Create failed", detail: err.message, tone: "error" });
    },
  });

  const refreshMut = useMutation({
    mutationFn: (id: number) => refreshHubAdminCache(hubUrl, jwt!, id),
    onSuccess: (data) => {
      pushToast({
        title: dict?.hub?.adminCacheRefreshed ?? "Cache refreshed",
        detail: t(dict?.hub?.adminSetsCount ?? "{{count}} sets", {
          count: data.totalCount.toLocaleString(),
        }),
        tone: "success",
      });
      invalidate();
    },
    onError: (err: Error) => {
      pushToast({ title: dict?.hub?.adminRefreshFailed ?? "Refresh failed", detail: err.message, tone: "error" });
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
      pushToast({ title: dict?.hub?.adminFrequencyUpdated ?? "Frequency updated", tone: "success" });
      invalidate();
    },
    onError: (err: Error) => {
      pushToast({ title: dict?.hub?.adminUpdateFailed ?? "Update failed", detail: err.message, tone: "error" });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteHubAdminCache(hubUrl, jwt!, id),
    onSuccess: () => {
      pushToast({ title: dict?.hub?.adminCacheDeleted ?? "Cache entry deleted", tone: "success" });
      invalidate();
    },
    onError: (err: Error) => {
      pushToast({ title: dict?.hub?.adminDeleteFailed ?? "Delete failed", detail: err.message, tone: "error" });
    },
  });

  const entries = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  if (!jwt) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <PageTitle>{dict?.hub?.searchCache ?? "Search cache"}</PageTitle>
          <p className="rx-subtitle">{dict?.hub?.adminLabel ?? "Admin"}</p>
        </div>
        <p className="text-sm text-muted">{dict?.hub?.adminLoginHint ?? "Log in to manage Download search caches."}</p>
        <HubLoginButton />
      </div>
    );
  }

  if (meQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <PageTitle>{dict?.hub?.searchCache ?? "Search cache"}</PageTitle>
          <p className="rx-subtitle">{dict?.hub?.adminLabel ?? "Admin"}</p>
        </div>
        <ListSkeleton count={3} showThumbnail={false} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <GoBackLink to="/hub">{dict?.hub?.workshop ?? "Community"}</GoBackLink>
          <PageTitle className="mt-3">{dict?.hub?.searchCache ?? "Search cache"}</PageTitle>
          <p className="rx-subtitle">{dict?.hub?.adminLabel ?? "Admin"}</p>
        </div>
        <p className="text-sm text-danger">{dict?.hub?.adminAccessRequired ?? "Admin access required."}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <GoBackLink to="/hub">{dict?.hub?.workshop ?? "Community"}</GoBackLink>
        <PageTitle className="mt-3">{dict?.hub?.searchCache ?? "Search cache"}</PageTitle>
        <p className="rx-subtitle">
          {dict?.hub?.adminCacheSubtitle ??
            "Prime one base index per mode/status/keys/sort — Download Maps filters stars, BPM, name, and mapper against stored stubs at request time"}
        </p>
      </div>

      <form
        className="rx-card flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          createMut.mutate();
        }}
      >
        <h2 className="text-sm font-semibold text-ink">{dict?.hub?.adminCreateBaseCache ?? "Create base cache"}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {dict?.hub?.adminFieldLabel ?? "Label"}
            <input
              className="rx-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={100}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {dict?.hub?.mode ?? "Mode"}
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
            {dict?.hub?.adminStatusField ?? "Status"}
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
            {dict?.hub?.sort ?? "Sort"}
            <select
              className="rx-input"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {hubStr(dict, o.key) ?? o.fallback}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {dict?.hub?.adminKeysField ?? "Keys (mania)"}
            <input
              className="rx-input"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={dict?.hub?.adminKeysPlaceholder ?? "e.g. 7"}
              inputMode="numeric"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            {dict?.hub?.adminFrequencyField ?? "Frequency check for new beatmaps"}
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
                  key={o.key}
                  value={o.minutes == null ? "" : String(o.minutes)}
                >
                  {hubStr(dict, o.key) ?? o.fallback}
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
          {createMut.isPending
            ? (dict?.hub?.adminPriming ?? "Priming…")
            : (dict?.hub?.adminCreatePrime ?? "Create & prime")}
        </button>
      </form>

      {listQuery.isLoading ? (
        <ListSkeleton count={4} showThumbnail={false} />
      ) : listQuery.error ? (
        <p className="text-sm text-danger">{listQuery.error.message}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">{dict?.hub?.adminNoEntries ?? "No cache entries yet."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="rx-card flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-ink">
                    {entry.label ||
                      t(dict?.hub?.adminCacheNum ?? "Cache #{{id}}", {
                        id: entry.id,
                      })}
                  </h3>
                  <p className="text-xs text-muted">
                    {paramsSummary(dict, entry.queryParams)} ·{" "}
                    {t(dict?.hub?.adminSetsCount ?? "{{count}} sets", {
                      count: entry.totalCount.toLocaleString(),
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {entry.stale ? (
                    <span className="rounded bg-warning/20 px-2 py-0.5 text-warning">
                      {dict?.hub?.adminStale ?? "Stale"}
                    </span>
                  ) : (
                    <span className="rounded bg-success/15 px-2 py-0.5 text-success">
                      {dict?.hub?.adminFresh ?? "Fresh"}
                    </span>
                  )}
                  {entry.refreshError ? (
                    <span className="rounded bg-danger/20 px-2 py-0.5 text-danger">
                      {dict?.hub?.adminErrorBadge ?? "Error"}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
                <span>
                  {dict?.hub?.adminLastRefresh ?? "Last refresh:"}{" "}
                  {entry.lastRefreshAt
                    ? formatRelativeTime(entry.lastRefreshAt, dict?.common)
                    : (dict?.hub?.adminNever ?? "never")}
                </span>
                <span>
                  {dict?.hub?.adminFrequencySelect ?? "Frequency"}:{" "}
                  {frequencyLabel(dict, entry.refreshIntervalMinutes)}
                  {entry.nextRefreshAt
                    ? `${dict?.hub?.adminNextPrefix ?? " · next "}${formatRelativeTime(entry.nextRefreshAt, dict?.common)}`
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
                  {dict?.hub?.adminFrequencySelect ?? "Frequency"}
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
                        key={o.key}
                        value={o.minutes == null ? "" : String(o.minutes)}
                      >
                        {hubStr(dict, o.key) ?? o.fallback}
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
                  {dict?.hub?.adminRefreshNow ?? "Refresh now"}
                </button>
                <button
                  type="button"
                  className="rx-btn text-sm text-danger"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        t(dict?.hub?.adminDeleteConfirm ?? "Delete cache “{{name}}”?", {
                          name: entry.label || entry.id,
                        }),
                      )
                    ) {
                      deleteMut.mutate(entry.id);
                    }
                  }}
                >
                  {dict?.hub?.delete ?? "Delete"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
