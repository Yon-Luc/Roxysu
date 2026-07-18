import { treaty } from "@elysia/eden";
import type { App } from "@server/app";

/** End-to-end typed client for the Elysia server (same origin). */
export const api = treaty<App>(
  typeof window !== "undefined" ? window.location.host : "localhost:3000",
);

function unwrap<T>(
  result: {
    data: T | null;
    error: { status: unknown; value: unknown } | null;
  },
  label: string,
): T {
  if (result.error || result.data == null) {
    const status = result.error?.status ?? "unknown";
    const value = result.error?.value;
    const detail =
      value && typeof value === "object" && "error" in value
        ? String((value as { error: unknown }).error)
        : String(status);
    throw new Error(`${label} failed: ${detail}`);
  }
  return result.data;
}

export async function fetchSystemStatus() {
  return unwrap(await api.api.system.status.get(), "/api/system/status");
}

export async function fetchDashboard() {
  return unwrap(await api.api.dashboard.get(), "/api/dashboard");
}

export type PracticeSortBy =
  | "lastPlayed"
  | "accuracy"
  | "misses"
  | "score"
  | "pp"
  | "mastery"
  | "stars";

export type PracticeSortDir = "asc" | "desc";

export type PracticeMetric = "accuracy" | "misses" | "score";

export async function fetchPracticeList(params: {
  page?: number;
  pageSize?: number;
  q?: string;
  sortBy?: PracticeSortBy;
  sortDir?: PracticeSortDir;
}) {
  return unwrap(
    await api.api.practice.get({
      query: {
        page: params.page,
        pageSize: params.pageSize,
        q: params.q,
        sortBy: params.sortBy,
        sortDir: params.sortDir,
      },
    }),
    "/api/practice",
  );
}

export async function fetchPracticeDistribution(params: {
  q?: string;
  metric?: PracticeMetric;
}) {
  return unwrap(
    await api.api.practice.distribution.get({
      query: {
        q: params.q,
        metric: params.metric,
      },
    }),
    "/api/practice/distribution",
  );
}

export async function fetchBeatmap(id: string) {
  return unwrap(await api.api.beatmaps({ id }).get(), `/api/beatmaps/${id}`);
}

export async function fetchSessions() {
  return unwrap(await api.api.sessions.get(), "/api/sessions");
}

export async function fetchCollections() {
  return unwrap(await api.api.collections.get(), "/api/collections");
}

export async function createCollection(body: { name: string; query: string }) {
  return unwrap(
    await api.api.collections.post(body),
    "/api/collections",
  );
}

export async function deleteCollection(id: number) {
  return unwrap(
    await api.api.collections({ id: String(id) }).delete(),
    `/api/collections/${id}`,
  );
}

export async function fetchCollectionResults(
  id: number,
  params?: { page?: number; pageSize?: number },
) {
  return unwrap(
    await api.api.collections({ id: String(id) }).results.get({
      query: {
        page: params?.page,
        pageSize: params?.pageSize,
      },
    }),
    `/api/collections/${id}/results`,
  );
}

export async function fetchSettings() {
  return unwrap(await api.api.settings.get(), "/api/settings");
}

export async function patchSettings(body: { masteryFormulaId?: string }) {
  return unwrap(await api.api.settings.patch(body), "/api/settings");
}

export type SystemStatus = Awaited<ReturnType<typeof fetchSystemStatus>>;
export type Dashboard = Awaited<ReturnType<typeof fetchDashboard>>;
export type PracticeList = Exclude<
  Awaited<ReturnType<typeof fetchPracticeList>>,
  { error: string }
>;
export type PracticeItem = PracticeList["items"][number];
export type PracticeDistribution = Exclude<
  Awaited<ReturnType<typeof fetchPracticeDistribution>>,
  { error: string }
>;
export type BeatmapProfile = Exclude<
  Awaited<ReturnType<typeof fetchBeatmap>>,
  { error: string }
>;
export type RecentScore = Dashboard["recentScores"][number];
export type SessionsPayload = Awaited<ReturnType<typeof fetchSessions>>;
export type CollectionsPayload = Awaited<ReturnType<typeof fetchCollections>>;
export type SettingsPayload = Awaited<ReturnType<typeof fetchSettings>>;
