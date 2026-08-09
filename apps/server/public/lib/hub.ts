import { useQuery } from "@tanstack/react-query";
import { fetchSystemStatus } from "./api";

const HUB_JWT_KEY = "roxysu:hub-jwt";

export function getHubJwt(): string | null {
  try {
    return localStorage.getItem(HUB_JWT_KEY);
  } catch {
    return null;
  }
}

export function setHubJwt(token: string): void {
  localStorage.setItem(HUB_JWT_KEY, token);
}

export function clearHubJwt(): void {
  localStorage.removeItem(HUB_JWT_KEY);
}

export function useHubUrl(): string {
  const { data } = useQuery({
    queryKey: ["system-status"],
    queryFn: fetchSystemStatus,
    staleTime: 60_000,
  });
  return data?.hubUrl ?? "http://localhost:4322";
}

export function hubLoginUrl(hubUrl: string): string {
  return `${hubUrl.replace(/\/$/, "")}/auth/login`;
}

export const HUB_TAGS = [
  "mania",
  "4k",
  "7k",
  "multi-mode",
  "jump",
  "stream",
  "tech",
  "ln",
  "rice",
  "hybrid",
  "sv",
  "beginner",
  "dan",
] as const;

export type HubTag = (typeof HUB_TAGS)[number];

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
  opts: { page?: number; limit?: number; tag?: string; token?: string | null },
) {
  const q = new URLSearchParams();
  q.set("page", String(opts.page ?? 0));
  q.set("limit", String(opts.limit ?? 20));
  if (opts.tag) q.set("tag", opts.tag);
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
  },
) {
  return hubFetch<{ id: number; message: string }>(hubUrl, "/collections", {
    method: "POST",
    token,
    body: JSON.stringify(body),
  });
}
