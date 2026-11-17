import type {
  PracticeMetric,
  PracticeSortBy,
  PracticeSortDir,
} from "./api";
import type { StatsSkillAxis } from "./api";

export const PRACTICE_SEARCH_KEY = "roxysu:practice-search";

export type StoredPracticeSearch = {
  q: string;
  page: number;
  sortBy: PracticeSortBy;
  sortDir: PracticeSortDir;
  metric: PracticeMetric;
};

const SORT_OPTIONS: PracticeSortBy[] = [
  "lastPlayed",
  "accuracy",
  "misses",
  "score",
  "pp",
  "mastery",
  "stars",
];

const METRIC_OPTIONS: PracticeMetric[] = ["accuracy", "misses", "score"];

function isSortBy(value: unknown): value is PracticeSortBy {
  return (SORT_OPTIONS as readonly string[]).includes(value as string);
}

function isSortDir(value: unknown): value is PracticeSortDir {
  return value === "asc" || value === "desc";
}

function isMetric(value: unknown): value is PracticeMetric {
  return (METRIC_OPTIONS as readonly string[]).includes(value as string);
}

export function readStoredPracticeSearch(): StoredPracticeSearch {
  try {
    const raw = localStorage.getItem(PRACTICE_SEARCH_KEY);
    if (!raw) {
      return {
        q: "",
        page: 1,
        sortBy: "lastPlayed",
        sortDir: "desc",
        metric: "accuracy",
      };
    }
    const parsed = JSON.parse(raw) as Partial<StoredPracticeSearch>;
    return {
      q: typeof parsed.q === "string" ? parsed.q : "",
      page:
        typeof parsed.page === "number" &&
        Number.isFinite(parsed.page) &&
        parsed.page >= 1
          ? Math.floor(parsed.page)
          : 1,
      sortBy: isSortBy(parsed.sortBy) ? parsed.sortBy : "lastPlayed",
      sortDir: isSortDir(parsed.sortDir) ? parsed.sortDir : "desc",
      metric: isMetric(parsed.metric) ? parsed.metric : "accuracy",
    };
  } catch {
    return {
      q: "",
      page: 1,
      sortBy: "lastPlayed",
      sortDir: "desc",
      metric: "accuracy",
    };
  }
}

export function writeStoredPracticeSearch(state: StoredPracticeSearch) {
  try {
    localStorage.setItem(PRACTICE_SEARCH_KEY, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

const PRACTICE_SEARCH_FIELDS = ["q", "page", "sortBy", "sortDir", "metric"] as const;

export function practiceSearchIsEmpty(search: Record<string, unknown>): boolean {
  return !PRACTICE_SEARCH_FIELDS.some((key) => {
    const value = search[key];
    return value != null && value !== "";
  });
}

/**
 * URL search when present; otherwise the last stored filter (or defaults).
 * Fields stay optional in the type so plain links to `/practice` stay valid.
 */
export function parsePracticeSearch(
  search: Record<string, unknown>,
): Partial<StoredPracticeSearch> {
  if (practiceSearchIsEmpty(search)) return readStoredPracticeSearch();
  const page = Number(search.page);
  return {
    q: typeof search.q === "string" ? search.q : "",
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    sortBy: isSortBy(search.sortBy) ? search.sortBy : "lastPlayed",
    sortDir: isSortDir(search.sortDir) ? search.sortDir : "desc",
    metric: isMetric(search.metric) ? search.metric : "accuracy",
  };
}

/** Search payload for “open these maps in Beatmaps”, keeping the last sort. */
export function practiceSearchForQuery(query: string): StoredPracticeSearch {
  return { ...readStoredPracticeSearch(), q: query, page: 1 };
}

/** Practice query for a stats rank bucket, matching current keymode and axis. */
export function buildStatsGradeQuery(
  keyCount: number,
  skillAxis: StatsSkillAxis,
  grade: string,
): string {
  const parts = [`key=${keyCount}`, `grade:${grade.trim().toUpperCase()}`];
  if (skillAxis === "rc") parts.push("axis:rc");
  else if (skillAxis === "ln") parts.push("axis:ln");
  else if (skillAxis === "fln") parts.push("axis:fln");
  return parts.join(" ");
}
