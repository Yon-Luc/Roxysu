import { treaty } from "@elysia/eden";
import type { App } from "@server/app";

/** End-to-end typed client for the Elysia server (same origin). */
export const api = treaty<App>(
  typeof window !== "undefined" ? window.location.host : "localhost:4321",
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

export async function fetchPracticePatterns(params?: {
  samples?: number;
  axis?: "all" | "rc" | "ln";
}) {
  return unwrap(
    await api.api.practice.patterns.get({
      query: {
        samples: params?.samples,
        axis: params?.axis === "all" ? undefined : params?.axis,
      },
    }),
    "/api/practice/patterns",
  );
}

export async function fetchPracticeSample(params: {
  q?: string;
  count?: number;
  exclude?: string[];
}) {
  return unwrap(
    await api.api.practice.sample.get({
      query: {
        q: params.q,
        count: params.count,
        exclude:
          params.exclude && params.exclude.length > 0
            ? params.exclude.join(",")
            : undefined,
      },
    }),
    "/api/practice/sample",
  );
}

export type RecommendFocus =
  | "push"
  | "consistency"
  | "deficit"
  | "skillset";

export type RecommendSkillset = "both" | "rc" | "ln";

export async function fetchPracticeRecommend(params: {
  focus?: RecommendFocus;
  skillset?: RecommendSkillset;
  count?: number;
  exclude?: string[];
  q?: string;
}) {
  return unwrap(
    await api.api.practice.recommend.get({
      query: {
        focus: params.focus,
        skillset: params.skillset,
        count: params.count,
        exclude:
          params.exclude && params.exclude.length > 0
            ? params.exclude.join(",")
            : undefined,
        q: params.q,
      },
    }),
    "/api/practice/recommend",
  );
}

export async function fetchBeatmap(id: string) {
  return unwrap(await api.api.beatmaps({ id }).get(), `/api/beatmaps/${id}`);
}

export async function fetchBeatmapPreview(id: string) {
  return unwrap(
    await api.api.beatmaps({ id }).preview.get(),
    `/api/beatmaps/${id}/preview`,
  );
}

export async function fetchMusicDrift(beatmapId: string) {
  return unwrap(
    await api.api.beatmaps({ id: beatmapId })["music-drift"].post(),
    `/api/beatmaps/${beatmapId}/music-drift`,
  );
}

export async function fetchScoreReplay(id: string) {
  return unwrap(
    await api.api.scores({ id }).replay.get(),
    `/api/scores/${id}/replay`,
  );
}

export async function fetchSessions() {
  return unwrap(await api.api.sessions.get(), "/api/sessions");
}

export async function fetchSession(id: string | number) {
  return unwrap(
    await api.api.sessions({ id: String(id) }).get(),
    `/api/sessions/${id}`,
  );
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

export type LazerCollectionSyncResult = {
  created: number;
  updated: number;
  deleted: number;
  skippedNoMd5: number;
  backupPath: string;
  syncedAt: string;
};

export async function syncCollectionsToLazer(): Promise<LazerCollectionSyncResult> {
  const result = await api.api.collections["sync-lazer"].post();
  return unwrap(result, "/api/collections/sync-lazer") as LazerCollectionSyncResult;
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

export async function patchSettings(body: {
  masteryFormulaId?: string;
  pauseWhenUnfocused?: boolean;
  osuDataPath?: string | null;
}) {
  return unwrap(await api.api.settings.patch(body), "/api/settings");
}

export async function fetchSunnyDanJob() {
  return unwrap(
    await api.api.settings["sunny-dan"].get(),
    "/api/settings/sunny-dan",
  );
}

export async function startSunnyDanJob() {
  return unwrap(
    await api.api.settings["sunny-dan"].start.post(),
    "/api/settings/sunny-dan/start",
  );
}

export async function stopSunnyDanJob() {
  return unwrap(
    await api.api.settings["sunny-dan"].stop.post(),
    "/api/settings/sunny-dan/stop",
  );
}

export async function fetchPatternAnalysisJob() {
  return unwrap(
    await api.api.settings["pattern-analysis"].get(),
    "/api/settings/pattern-analysis",
  );
}

export async function startPatternAnalysisJob() {
  return unwrap(
    await api.api.settings["pattern-analysis"].start.post(),
    "/api/settings/pattern-analysis/start",
  );
}

export async function stopPatternAnalysisJob() {
  return unwrap(
    await api.api.settings["pattern-analysis"].stop.post(),
    "/api/settings/pattern-analysis/stop",
  );
}

export async function fetchMapgenStatus() {
  return unwrap(await api.api.mapgen.status.get(), "/api/mapgen/status");
}

export type MapgenGenerateInput = {
  audio: File;
  background?: File;
  title?: string;
  artist?: string;
  creator?: string;
  version?: string;
  delay?: number;
  jack?: number;
  chordjack?: number;
  chordstream?: number;
  bracket?: number;
  ln?: number;
  bpm?: number;
  seed?: number;
  endSec?: number;
  format?: "zip" | "osu";
};

export async function generateMapgenPack(
  input: MapgenGenerateInput,
): Promise<{
  blob: Blob;
  filename: string;
  bpm: string | null;
  notes: string | null;
  dominant: string | null;
}> {
  const form = new FormData();
  form.append("audio", input.audio);
  if (input.background) form.append("background", input.background);
  const fields: Record<string, string | number | undefined> = {
    title: input.title,
    artist: input.artist,
    creator: input.creator,
    version: input.version,
    delay: input.delay,
    jack: input.jack,
    chordjack: input.chordjack,
    chordstream: input.chordstream,
    bracket: input.bracket,
    ln: input.ln,
    bpm: input.bpm,
    seed: input.seed,
    endSec: input.endSec,
    format: input.format ?? "zip",
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    form.append(key, String(value));
  }

  const res = await fetch("/api/mapgen", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const json = (await res.json()) as { error?: string };
      if (json.error) detail = json.error;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? "generated.osz";

  return {
    blob: await res.blob(),
    filename,
    bpm: res.headers.get("X-Mapgen-Bpm"),
    notes: res.headers.get("X-Mapgen-Notes"),
    dominant: res.headers.get("X-Mapgen-Dominant"),
  };
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
export type PracticePatterns = Exclude<
  Awaited<ReturnType<typeof fetchPracticePatterns>>,
  { error: string }
>;
export type PracticeSample = Exclude<
  Awaited<ReturnType<typeof fetchPracticeSample>>,
  { error: string }
>;
export type PracticeRecommend = Exclude<
  Awaited<ReturnType<typeof fetchPracticeRecommend>>,
  { error: string }
>;
export type BeatmapProfile = Exclude<
  Awaited<ReturnType<typeof fetchBeatmap>>,
  { error: string }
>;
export type BeatmapPreview = Exclude<
  Awaited<ReturnType<typeof fetchBeatmapPreview>>,
  { error: string }
>;
export type ScoreReplay = Exclude<
  Awaited<ReturnType<typeof fetchScoreReplay>>,
  { error: string }
>;
export type RecentScore = Dashboard["recentScores"][number];
export type SessionsPayload = Awaited<ReturnType<typeof fetchSessions>>;
export type SessionDetail = Exclude<
  Awaited<ReturnType<typeof fetchSession>>,
  { error: string }
>;
export type CollectionsPayload = Awaited<ReturnType<typeof fetchCollections>>;
export type SettingsPayload = Awaited<ReturnType<typeof fetchSettings>>;
