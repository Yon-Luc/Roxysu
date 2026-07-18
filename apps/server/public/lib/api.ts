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
    throw new Error(`${label} failed: ${String(status)}`);
  }
  return result.data;
}

export async function fetchSystemStatus() {
  return unwrap(await api.api.system.status.get(), "/api/system/status");
}

export async function fetchDashboard() {
  return unwrap(await api.api.dashboard.get(), "/api/dashboard");
}

export async function fetchPracticeList(params: {
  page?: number;
  pageSize?: number;
  q?: string;
}) {
  return unwrap(
    await api.api.practice.get({
      query: {
        page: params.page,
        pageSize: params.pageSize,
        q: params.q,
      },
    }),
    "/api/practice",
  );
}

export async function fetchBeatmap(id: string) {
  return unwrap(await api.api.beatmaps({ id }).get(), `/api/beatmaps/${id}`);
}

export type SystemStatus = Awaited<ReturnType<typeof fetchSystemStatus>>;
export type Dashboard = Awaited<ReturnType<typeof fetchDashboard>>;
export type PracticeList = Awaited<ReturnType<typeof fetchPracticeList>>;
export type PracticeItem = PracticeList["items"][number];
export type BeatmapProfile = Awaited<ReturnType<typeof fetchBeatmap>>;
export type RecentScore = Dashboard["recentScores"][number];
