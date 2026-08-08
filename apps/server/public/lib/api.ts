import { treaty } from "@elysia/eden";
import type { LazerCollectionSyncSuccess } from "@roxysu/collection-sync";
import type { App } from "@server/app";
import type {
  RecommendFocus,
  RecommendSkillsetFilter,
} from "@server/analytics/recommend/types";
import type {
  PracticeMetric,
  PracticeSortBy,
  PracticeSortDir,
} from "@server/query-language";

export type { PracticeSortBy, PracticeSortDir, PracticeMetric };
export type RecommendSkillset = RecommendSkillsetFilter;
export type { RecommendFocus };

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

export type StatsGranularity = "day" | "week";
export type StatsRange = 30 | 90 | 180;
export type StatsSkillAxis = "all" | "rc" | "ln" | "fln";

export async function fetchStats(params?: {
  granularity?: StatsGranularity;
  range?: StatsRange;
  skillTopPlays?: number;
  keyCount?: number;
}) {
  return unwrap(
    await api.api.stats.get({
      query: {
        granularity: params?.granularity,
        range: params?.range,
        skillTopPlays: params?.skillTopPlays,
        keyCount: params?.keyCount,
      },
    }),
    "/api/stats",
  );
}

export type SkillBandKind = "push" | "accuracy" | "consistency";

export async function fetchSkillBandPlays(params: {
  band: SkillBandKind;
  axis?: StatsSkillAxis;
  topPlays?: number;
  keyCount?: number;
}) {
  return unwrap(
    await api.api.stats["skill-plays"].get({
      query: {
        band: params.band,
        axis: params.axis,
        topPlays: params.topPlays,
        keyCount: params.keyCount,
      },
    }),
    "/api/stats/skill-plays",
  );
}

export type PlayerStats = Awaited<ReturnType<typeof fetchStats>>;

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

export async function fetchSearch(params: {
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  return unwrap(
    await api.api.search.get({
      query: {
        q: params.q,
        page: params.page,
        pageSize: params.pageSize,
      },
    }),
    "/api/search",
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
  keymode?: 4 | 7;
}) {
  return unwrap(
    await api.api.practice.patterns.get({
      query: {
        samples: params?.samples,
        axis: params?.axis === "all" ? undefined : params?.axis,
        keymode: params?.keymode,
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

export async function fetchPracticeRecommend(params: {
  focus?: RecommendFocus;
  skillset?: RecommendSkillset;
  count?: number;
  exclude?: string[];
  q?: string;
  topPlays?: number;
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
        topPlays: params.topPlays,
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

export async function updateCollection(
  id: number,
  body: { name?: string; query?: string },
) {
  return unwrap(
    await api.api.collections({ id: String(id) }).patch(body),
    `/api/collections/${id}`,
  );
}

export type LazerCollectionSyncResult = LazerCollectionSyncSuccess;

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

export async function fetchMirrorSearch(params: {
  /** App query language (catalog subset). Preferred over legacy q/mode/status. */
  query?: string;
  q?: string;
  mode?: "any" | "osu" | "taiko" | "fruits" | "mania";
  status?:
    | "any"
    | "ranked"
    | "qualified"
    | "loved"
    | "pending"
    | "graveyard";
  sort?:
    | "ranked_desc"
    | "ranked_asc"
    | "plays_desc"
    | "favourites_desc"
    | "difficulty_desc"
    | "title_asc";
  page?: number;
  excludeOwned?: boolean;
}) {
  return unwrap(
    await api.api.mirrors.search.get({
      query: {
        query: params.query,
        q: params.q,
        mode: params.mode,
        status: params.status,
        sort: params.sort,
        page: params.page,
        excludeOwned: params.excludeOwned,
      },
    }),
    "/api/mirrors/search",
  );
}

export async function fetchMirrorDownloadDir() {
  return unwrap(
    await api.api.mirrors["download-dir"].get(),
    "/api/mirrors/download-dir",
  );
}

export async function fetchMirrorBatchJob() {
  return unwrap(await api.api.mirrors.batch.get(), "/api/mirrors/batch");
}

export async function countMirrorMissing(params: {
  query: string;
  sort?:
    | "ranked_desc"
    | "ranked_asc"
    | "plays_desc"
    | "favourites_desc"
    | "difficulty_desc"
    | "title_asc";
  excludeOwned?: boolean;
}) {
  return unwrap(
    await api.api.mirrors.count.get({
      query: {
        query: params.query,
        sort: params.sort,
        excludeOwned: params.excludeOwned,
      },
    }),
    "/api/mirrors/count",
  );
}

export async function startMirrorBatchJob(body: {
  mode?: "pages" | "query";
  query?: string;
  q?: string;
  ruleset?: "any" | "osu" | "taiko" | "fruits" | "mania";
  status?:
    | "any"
    | "ranked"
    | "qualified"
    | "loved"
    | "pending"
    | "graveyard";
  sort?:
    | "ranked_desc"
    | "ranked_asc"
    | "plays_desc"
    | "favourites_desc"
    | "difficulty_desc"
    | "title_asc";
  startPage?: number;
  pageCount?: number;
  maxPages?: number;
  maxSets?: number;
  noVideo?: boolean;
  excludeOwned?: boolean;
  downloadConcurrency?: number;
}) {
  return unwrap(
    await api.api.mirrors.batch.start.post(body),
    "/api/mirrors/batch/start",
  );
}

export async function stopMirrorBatchJob() {
  return unwrap(
    await api.api.mirrors.batch.stop.post(),
    "/api/mirrors/batch/stop",
  );
}

export async function openLastBatchInOsu() {
  return unwrap(
    await api.api.mirrors.batch["open-in-osu"].post(),
    "/api/mirrors/batch/open-in-osu",
  );
}

export async function saveMirrorBeatmapset(body: {
  setId: number;
  artist?: string;
  title?: string;
  noVideo?: boolean;
}) {
  const res = await fetch(`/api/mirrors/beatmapsets/${body.setId}/save`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      artist: body.artist,
      title: body.title,
      noVideo: body.noVideo,
    }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(
      `/api/mirrors/beatmapsets/${body.setId}/save failed: ${detail}`,
    );
  }
  return data as MirrorBatchJob & {
    setId: number;
    result: "downloaded" | "exists";
    path: string;
  };
}

export async function fetchMirrorProviders() {
  return unwrap(
    await api.api.mirrors.providers.get(),
    "/api/mirrors/providers",
  );
}

export type MirrorSearchPayload = Exclude<
  Awaited<ReturnType<typeof fetchMirrorSearch>>,
  { error: string }
>;
export type OnlineBeatmapSet = MirrorSearchPayload["items"][number];
export type MirrorBatchJob = Exclude<
  Awaited<ReturnType<typeof fetchMirrorBatchJob>>,
  { error: string }
>;
export type MirrorProviders = Exclude<
  Awaited<ReturnType<typeof fetchMirrorProviders>>,
  { error: string }
>;
export type MirrorMissingCount = Exclude<
  Awaited<ReturnType<typeof countMirrorMissing>>,
  { error: string }
>;


export async function patchSettings(body: {
  masteryFormulaId?: string;
  pauseWhenUnfocused?: boolean;
  scoresUsernameFilter?: string | string[];
  scoresGamemodeFilter?: string;
  osuDataPath?: string | null;
  tosuEnabled?: boolean;
  tosuHost?: string;
  tosuExecutablePath?: string | null;
  maniaRatingExecutables?: Record<string, string | null>;
}) {
  return unwrap(await api.api.settings.patch(body), "/api/settings");
}

export async function fetchTosuLive() {
  return unwrap(await api.api.tosu.live.get(), "/api/tosu/live");
}

export async function startTosu() {
  return unwrap(await api.api.tosu.start.post(), "/api/tosu/start");
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

export async function fetchDanielDanJob() {
  return unwrap(
    await api.api.settings["daniel-dan"].get(),
    "/api/settings/daniel-dan",
  );
}

export async function startDanielDanJob() {
  return unwrap(
    await api.api.settings["daniel-dan"].start.post(),
    "/api/settings/daniel-dan/start",
  );
}

export async function stopDanielDanJob() {
  return unwrap(
    await api.api.settings["daniel-dan"].stop.post(),
    "/api/settings/daniel-dan/stop",
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

export async function recomputePatternAnalysisJob() {
  return unwrap(
    await api.api.settings["pattern-analysis"].recompute.post(),
    "/api/settings/pattern-analysis/recompute",
  );
}

export async function stopPatternAnalysisJob() {
  return unwrap(
    await api.api.settings["pattern-analysis"].stop.post(),
    "/api/settings/pattern-analysis/stop",
  );
}

export async function fetchRatingLabVersions() {
  return unwrap(
    await api.api["rating-lab"].versions.get(),
    "/api/rating-lab/versions",
  );
}

export async function fetchRatingLabCompare(params: {
  q: string;
  baseline?: string;
  experiment?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: string;
  name?: string;
  ppAccuracy?: number | string;
}) {
  return unwrap(
    await api.api["rating-lab"].compare.get({ query: params }),
    "/api/rating-lab/compare",
  );
}

export async function fetchRatingLabSummary(params: {
  q: string;
  baseline?: string;
  experiment?: string;
  ppAccuracy?: number | string;
}) {
  return unwrap(
    await api.api["rating-lab"].compare.summary.get({ query: params }),
    "/api/rating-lab/compare/summary",
  );
}

export async function fetchRatingLabJob() {
  return unwrap(
    await api.api["rating-lab"].job.get(),
    "/api/rating-lab/job",
  );
}

export async function startRatingLabJob(body: {
  versionId: string;
  query?: string;
  force?: boolean;
}) {
  return unwrap(
    await api.api["rating-lab"].job.start.post(body),
    "/api/rating-lab/job/start",
  );
}

export async function stopRatingLabJob() {
  return unwrap(
    await api.api["rating-lab"].job.stop.post(),
    "/api/rating-lab/job/stop",
  );
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
export type RatingLabCompare = Exclude<
  Awaited<ReturnType<typeof fetchRatingLabCompare>>,
  { error: string }
>;
export type RatingLabCompareItem = RatingLabCompare["items"][number];
export type RatingLabSummary = Exclude<
  Awaited<ReturnType<typeof fetchRatingLabSummary>>,
  { error: string }
>;
export type SettingsPayload = Awaited<ReturnType<typeof fetchSettings>>;
export type TosuLive = Awaited<ReturnType<typeof fetchTosuLive>>;
