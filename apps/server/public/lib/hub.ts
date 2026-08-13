import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSystemStatus } from "./api";

const HUB_JWT_KEY = "roxysu:hub-jwt";

const jwtListeners = new Set<() => void>();

function notifyHubJwtListeners(): void {
  for (const listener of jwtListeners) listener();
}

export function getHubJwt(): string | null {
  try {
    return localStorage.getItem(HUB_JWT_KEY);
  } catch {
    return null;
  }
}

export function setHubJwt(token: string): void {
  localStorage.setItem(HUB_JWT_KEY, token);
  notifyHubJwtListeners();
}

export function clearHubJwt(): void {
  localStorage.removeItem(HUB_JWT_KEY);
  notifyHubJwtListeners();
}

/** Reactive hub JWT for UI that must update after Electron browser handoff. */
export function useHubJwt(): string | null {
  const [jwt, setJwt] = useState(getHubJwt);
  useEffect(() => {
    const sync = () => setJwt(getHubJwt());
    jwtListeners.add(sync);
    return () => {
      jwtListeners.delete(sync);
    };
  }, []);
  return jwt;
}

export function useHubUrl(): string {
  const { data } = useQuery({
    queryKey: ["system-status"],
    queryFn: fetchSystemStatus,
    staleTime: 60_000,
  });
  return data?.hubUrl ?? "http://localhost:4322";
}

export function hubLoginUrl(
  hubUrl: string,
  opts?: { client?: "desktop"; handoff?: string },
): string {
  const base = `${hubUrl.replace(/\/$/, "")}/auth/login`;
  const q = new URLSearchParams();
  if (opts?.client === "desktop") q.set("client", "desktop");
  if (opts?.handoff) q.set("handoff", opts.handoff);
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

/** Start a desktop OAuth handoff; returns opaque id for login URL + poll. */
export async function beginHubOAuthHandoff(): Promise<string> {
  const res = await fetch("/api/system/hub-oauth/begin", {
    method: "POST",
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const data = (await res.json()) as { handoff?: string; error?: string };
  if (!res.ok || !data.handoff) {
    throw new Error(data.error ?? `Hub OAuth begin failed: HTTP ${res.status}`);
  }
  return data.handoff;
}

/**
 * Poll the local Roxysu server until it redeems the hub handoff JWT
 * (Electron only).
 */
export async function pollHubOAuthPending(
  handoff: string,
  signal?: AbortSignal,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<string> {
  const intervalMs = opts?.intervalMs ?? 1000;
  const timeoutMs = opts?.timeoutMs ?? 10 * 60 * 1000;
  const started = Date.now();
  const q = new URLSearchParams({ h: handoff });

  while (!signal?.aborted) {
    const res = await fetch(`/api/system/hub-oauth/pending?${q}`, {
      signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Hub OAuth pending failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { token: string | null };
    if (data.token) return data.token;
    if (Date.now() - started > timeoutMs) {
      throw new Error("Login timed out — try again");
    }
    await sleep(intervalMs, signal);
  }

  throw new DOMException("Aborted", "AbortError");
}

/** Redeem a one-time web OAuth handoff id for a JWT (hash callback). */
export async function redeemHubHandoff(
  hubUrl: string,
  handoffId: string,
): Promise<string> {
  const res = await fetch(
    `${hubUrl.replace(/\/$/, "")}/auth/handoff/${encodeURIComponent(handoffId)}`,
    {
      headers: { accept: "application/json" },
      cache: "no-store",
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    message?: string;
  };
  if (!res.ok || !data.token) {
    throw new Error(data.message ?? `Handoff failed: HTTP ${res.status}`);
  }
  return data.token;
}

export const HUB_MODE_TAGS = ["mania", "std", "ctb", "taiko"] as const;
export type HubModeTag = (typeof HUB_MODE_TAGS)[number];

/** Secondary tags per mode, grouped under category labels for the picker UI. */
export const HUB_TAG_GROUPS_BY_MODE = {
  mania: [
    { label: "Keys", tags: ["4k", "5k", "6k", "7k", "8k"] },
    {
      label: "Pattern",
      tags: [
        "jack",
        "minijack",
        "longjack",
        "chordjack",
        "jumpstream",
        "handstream",
        "chordstream",
        "stream",
        "delay",
        "bracket",
      ],
    },
    { label: "Style", tags: ["ln", "rice", "hybrid", "sv", "tech"] },
    { label: "Difficulty", tags: ["stamina", "speed", "dan", "beginner"] },
  ],
  std: [
    {
      label: "Pattern",
      tags: ["aim", "jump", "stream", "alt", "burst", "speed", "stamina"],
    },
    { label: "Style", tags: ["tech", "reading"] },
    { label: "Level", tags: ["beginner"] },
  ],
  ctb: [
    {
      label: "Pattern",
      tags: ["jump", "stream", "hyperdash", "stamina", "speed"],
    },
    { label: "Style", tags: ["tech", "anti-flow"] },
    { label: "Level", tags: ["beginner"] },
  ],
  taiko: [
    { label: "Pattern", tags: ["stream", "stamina", "speed"] },
    { label: "Style", tags: ["tech", "gimmick"] },
    { label: "Level", tags: ["beginner"] },
  ],
} as const satisfies Record<
  HubModeTag,
  readonly { label: string; tags: readonly string[] }[]
>;

/** Flat secondary tags per mode (derived from the grouped structure). */
export const HUB_TAGS_BY_MODE = {
  mania: HUB_TAG_GROUPS_BY_MODE.mania.flatMap((g) => g.tags),
  std: HUB_TAG_GROUPS_BY_MODE.std.flatMap((g) => g.tags),
  ctb: HUB_TAG_GROUPS_BY_MODE.ctb.flatMap((g) => g.tags),
  taiko: HUB_TAG_GROUPS_BY_MODE.taiko.flatMap((g) => g.tags),
} as const satisfies Record<HubModeTag, readonly string[]>;

/** Flat list of every selectable hub tag (modes + secondary). */
export const HUB_TAGS = [
  ...HUB_MODE_TAGS,
  "multi-mode",
  ...new Set([
    ...HUB_TAGS_BY_MODE.mania,
    ...HUB_TAGS_BY_MODE.std,
    ...HUB_TAGS_BY_MODE.ctb,
    ...HUB_TAGS_BY_MODE.taiko,
  ]),
] as const;

export type HubTag = (typeof HUB_TAGS)[number];

export function hubTagGroupsForMode(
  mode: HubModeTag | "all",
): readonly { label: string; tags: readonly string[] }[] {
  if (mode === "all") {
    return [
      {
        label: "All modes",
        tags: [
          "multi-mode",
          ...new Set([
            ...HUB_TAGS_BY_MODE.mania,
            ...HUB_TAGS_BY_MODE.std,
            ...HUB_TAGS_BY_MODE.ctb,
            ...HUB_TAGS_BY_MODE.taiko,
          ]),
        ],
      },
    ];
  }
  return HUB_TAG_GROUPS_BY_MODE[mode];
}

export function hubSecondaryTagsForMode(
  mode: HubModeTag | "all",
): readonly string[] {
  if (mode === "all") {
    return hubTagGroupsForMode("all")[0]!.tags;
  }
  return [...HUB_TAGS_BY_MODE[mode]];
}

export const HUB_MODE_LABELS: Record<HubModeTag | "all", string> = {
  all: "All",
  mania: "Mania",
  std: "Std",
  ctb: "CTB",
  taiko: "Taiko",
};

async function hubFetch<T>(
  hubUrl: string,
  path: string,
  init?: RequestInit & { token?: string | null },
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (init?.token) {
    headers.set("authorization", `Bearer ${init.token}`);
  }
  const res = await fetch(`${hubUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

export type HubMe = {
  id: number;
  osuId: number;
  username: string;
  avatarUrl: string | null;
  role: string;
};

export type HubCollectionListItem = {
  id: number;
  name: string;
  description: string;
  downloadCount: number;
  mapCount: number;
  favoriteCount: number;
  favoritedByMe: boolean;
  tags: string[];
  /** First few set IDs for cover mosaics on browse cards. */
  previewBeatmapsetIds: number[];
  /** Full beatmapset ID list (for local ownership diffs). */
  beatmapsetIds: number[];
  starsMin: number | null;
  starsMax: number | null;
  dominantMode: "osu" | "taiko" | "fruits" | "mania" | null;
  dominantKeys: number | null;
  createdAt: string;
  updatedAt: string;
  owner: {
    username: string;
    avatarUrl: string | null;
    osuId: number;
  };
};

export type HubCollectionDetail = HubCollectionListItem & {
  maps: Array<{ beatmapsetId: number; mapName: string }>;
};

export function fetchHubMe(hubUrl: string, token: string) {
  return hubFetch<HubMe>(hubUrl, "/auth/me", { token });
}

export function fetchHubCollections(
  hubUrl: string,
  opts: {
    page?: number;
    limit?: number;
    q?: string;
    /** @deprecated Prefer `tags`. */
    tag?: string;
    tags?: string[];
    token?: string | null;
  },
) {
  const q = new URLSearchParams();
  q.set("page", String(opts.page ?? 0));
  q.set("limit", String(opts.limit ?? 20));
  const search = opts.q?.trim();
  if (search) q.set("q", search);
  const tags = [
    ...new Set([
      ...(opts.tags ?? []),
      ...(opts.tag ? [opts.tag] : []),
    ].filter(Boolean)),
  ];
  if (tags.length > 0) q.set("tags", tags.join(","));
  return hubFetch<{
    data: HubCollectionListItem[];
    total: number;
    page: number;
    limit: number;
  }>(hubUrl, `/collections?${q}`, { token: opts.token });
}

export function fetchHubCollection(
  hubUrl: string,
  id: number,
  token?: string | null,
) {
  return hubFetch<HubCollectionDetail>(hubUrl, `/collections/${id}`, {
    token,
  });
}

export function exportHubCollection(hubUrl: string, id: number) {
  return hubFetch<{
    collectionId: number;
    name: string;
    beatmapsetIds: number[];
  }>(hubUrl, `/collections/${id}/export`);
}

export function favoriteHubCollection(
  hubUrl: string,
  id: number,
  token: string,
  favorited: boolean,
) {
  return hubFetch<{ message: string }>(
    hubUrl,
    `/collections/${id}/favorite`,
    {
      method: favorited ? "DELETE" : "POST",
      token,
    },
  );
}

export function createHubCollection(
  hubUrl: string,
  token: string,
  body: {
    name: string;
    description?: string;
    beatmapsetIds: number[];
    tags: string[];
    stats?: {
      starsMin: number | null;
      starsMax: number | null;
      dominantMode: "osu" | "taiko" | "fruits" | "mania" | null;
      dominantKeys: number | null;
    };
  },
) {
  return hubFetch<{ id: number; message: string }>(hubUrl, "/collections", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
}

export function updateHubCollection(
  hubUrl: string,
  token: string,
  id: number,
  body: {
    name?: string;
    description?: string;
    tags?: string[];
    beatmapsetIds?: number[];
    mapNames?: string[];
    stats?: {
      starsMin: number | null;
      starsMax: number | null;
      dominantMode: "osu" | "taiko" | "fruits" | "mania" | null;
      dominantKeys: number | null;
    };
  },
) {
  return hubFetch<{ message: string }>(hubUrl, `/collections/${id}`, {
    method: "PUT",
    token,
    body: JSON.stringify(body),
  });
}

export function fetchHubFavorites(hubUrl: string, token: string) {
  return hubFetch<{ data: HubCollectionListItem[] }>(
    hubUrl,
    "/collections/me/favorites",
    { token },
  );
}

export type HubSearchCacheEntry = {
  id: number;
  label: string;
  queryHash: string;
  queryParams: Record<string, string | number>;
  totalCount: number;
  cachedAt: string;
  stale: boolean;
  ageMs: number;
  refreshIntervalMinutes: number | null;
  lastRefreshAt: string | null;
  nextRefreshAt: string | null;
  refreshError: string | null;
};

export function fetchHubAdminCache(hubUrl: string, token: string) {
  return hubFetch<HubSearchCacheEntry[]>(hubUrl, "/admin/cache", { token });
}

export function createHubAdminCache(
  hubUrl: string,
  token: string,
  body: {
    label?: string;
    refreshIntervalMinutes?: number | null;
    query_params: {
      mode?: number;
      status?: string;
      query?: string;
      key?: number;
      sort?: string;
      min_stars?: number;
      max_stars?: number;
      creator?: string;
    };
  },
) {
  return hubFetch<{
    id: number;
    queryHash: string;
    totalCount: number;
    refreshIntervalMinutes: number | null;
    message: string;
  }>(hubUrl, "/admin/cache", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
}

export function patchHubAdminCache(
  hubUrl: string,
  token: string,
  id: number,
  body: {
    label?: string;
    refreshIntervalMinutes?: number | null;
  },
) {
  return hubFetch<HubSearchCacheEntry>(hubUrl, `/admin/cache/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(body),
  });
}

export function refreshHubAdminCache(
  hubUrl: string,
  token: string,
  id: number,
) {
  return hubFetch<{
    id: number;
    totalCount: number;
    cachedAt: string;
    lastRefreshAt: string | null;
    message: string;
  }>(hubUrl, `/admin/cache/${id}/refresh`, {
    method: "POST",
    token,
  });
}

export function deleteHubAdminCache(
  hubUrl: string,
  token: string,
  id: number,
) {
  return hubFetch<{ message: string }>(hubUrl, `/admin/cache/${id}`, {
    method: "DELETE",
    token,
  });
}
