import { hubFetch } from "../../lib/hub";
import type { BmsScoreRow, BmsSessionRow, BmsSyncStatus, BmsTableBlock, BmsVariantCount } from "./types";

async function localGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: "application/json" } });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}

export function fetchLocalBmsProfile(variant: string | null) {
  const q = variant ? `?variant=${encodeURIComponent(variant)}` : "";
  return localGet<{
    username: string | null;
    variantId: string | null;
    variants: BmsVariantCount[];
    plays: number;
    latestPlayedAt: number | null;
    recent: BmsScoreRow[];
  }>(`/api/bms/profile${q}`);
}

export function fetchLocalBmsSessions(variant: string | null) {
  const q = variant ? `?variant=${encodeURIComponent(variant)}` : "";
  return localGet<{ sessions: BmsSessionRow[] }>(`/api/bms/sessions${q}`);
}

export function fetchLocalBmsTables(variant: string, achievement: string) {
  const q = new URLSearchParams({ variant, achievement });
  return localGet<{ tables: BmsTableBlock[] }>(`/api/bms/tables?${q}`);
}

export function fetchBmsSync() {
  return localGet<BmsSyncStatus>("/api/bms/sync");
}

export async function patchBmsSync(body: {
  autoUpload?: boolean;
  historicalUpload?: boolean;
  hubJwt?: string | null;
}) {
  const res = await fetch("/api/bms/sync", {
    method: "PATCH",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as BmsSyncStatus & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}

export async function retryBmsSync() {
  const res = await fetch("/api/bms/sync/retry", { method: "POST" });
  const data = (await res.json().catch(() => ({}))) as BmsSyncStatus & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data;
}

export type PublicBmsProfile = {
  username: string;
  osuId: number;
  avatarUrl: string | null;
  countryCode: string | null;
  profilePublic: boolean;
  plays: number;
  latestPlayedAt: number | null;
  variants: BmsVariantCount[];
};

export function fetchPublicBmsProfile(hubUrl: string, username: string, token: string | null) {
  return hubFetch<PublicBmsProfile>(
    hubUrl,
    `/api/bms/profiles/${encodeURIComponent(username)}`,
    { token },
  );
}

export function fetchPublicBmsScores(
  hubUrl: string,
  username: string,
  variant: string | null,
  token: string | null,
) {
  const q = variant ? `?variant=${encodeURIComponent(variant)}&limit=20` : "?limit=20";
  return hubFetch<{ scores: BmsScoreRow[]; nextCursor: string | null }>(
    hubUrl,
    `/api/bms/profiles/${encodeURIComponent(username)}/scores${q}`,
    { token },
  );
}

export function fetchPublicBmsSessions(
  hubUrl: string,
  username: string,
  variant: string | null,
  token: string | null,
) {
  const q = variant ? `?variant=${encodeURIComponent(variant)}` : "";
  return hubFetch<{ sessions: BmsSessionRow[] }>(
    hubUrl,
    `/api/bms/profiles/${encodeURIComponent(username)}/sessions${q}`,
    { token },
  );
}

export function fetchPublicBmsTables(
  hubUrl: string,
  username: string,
  tableId: string,
  variant: string,
  achievement: string,
  token: string | null,
) {
  const q = new URLSearchParams({ tableId, variant, achievement });
  return hubFetch<BmsTableBlock & { achievement: string; variantId: string }>(
    hubUrl,
    `/api/bms/profiles/${encodeURIComponent(username)}/tables?${q}`,
    { token },
  );
}

export function fetchPublicBmsCatalogue(hubUrl: string) {
  return hubFetch<{
    tables: Array<{ id: string; name: string; symbol: string; latestVersionId: string | null }>;
  }>(hubUrl, "/api/bms/tables");
}

export function patchBmsPrivacy(hubUrl: string, token: string, profilePublic: boolean) {
  return hubFetch<{ profilePublic: boolean }>(hubUrl, "/api/me/bms/preferences", {
    method: "PATCH",
    token,
    body: JSON.stringify({ profilePublic }),
  });
}
