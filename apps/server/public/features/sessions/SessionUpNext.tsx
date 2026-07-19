import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BeatmapCover } from "../../components/BeatmapCover";
import { CopyBeatmapSearchButton } from "../../components/CopyBeatmapSearchButton";
import { QueryLanguageHelpButton } from "../../components/QueryLanguageHelpModal";
import {
  fetchPracticeSample,
  type PracticeItem,
} from "../../lib/api";
import {
  formatAccuracy,
  formatRelativeTime,
  osuClientBeatmapUrl,
} from "../../lib/format";
import {
  formatPrimaryRating,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";

const PREFS_KEY = "rx-session-up-next";
const PRACTICE_SEARCH_KEY = "roxysu:practice-search";

type AccMode = "improve" | "reach";
type BandPreset = "90-93" | "93-97" | "custom";
type StaleDays = 0 | 7 | 14 | 30;

type UpNextPrefs = {
  mode: AccMode;
  band: BandPreset;
  accMin: number;
  accMax: number;
  staleDays: StaleDays;
  starsMin: string;
  starsMax: string;
  includeUnplayed: boolean;
  query: string;
};

const BANDS: { id: BandPreset; label: string; min: number; max: number }[] = [
  { id: "90-93", label: "90–93%", min: 90, max: 93 },
  { id: "93-97", label: "93–97%", min: 93, max: 97 },
  { id: "custom", label: "Custom", min: 90, max: 95 },
];

const STALE_OPTIONS: { days: StaleDays; label: string }[] = [
  { days: 0, label: "Any time" },
  { days: 7, label: "7d+" },
  { days: 14, label: "14d+" },
  { days: 30, label: "30d+" },
];

const DEFAULT_PREFS: UpNextPrefs = {
  mode: "improve",
  band: "90-93",
  accMin: 90,
  accMax: 93,
  staleDays: 14,
  starsMin: "",
  starsMax: "",
  includeUnplayed: true,
  query: "",
};

function clampAcc(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function bandBounds(prefs: UpNextPrefs): { min: number; max: number } {
  if (prefs.band === "custom") {
    const min = clampAcc(prefs.accMin);
    const max = clampAcc(prefs.accMax);
    return min <= max ? { min, max } : { min: max, max: min };
  }
  const preset = BANDS.find((b) => b.id === prefs.band) ?? BANDS[0]!;
  return { min: preset.min, max: preset.max };
}

function buildQueryFromPresets(
  prefs: Omit<UpNextPrefs, "query">,
  rulesetShortName: string | null,
): string {
  const { min, max } = bandBounds(prefs as UpNextPrefs);
  const parts: string[] = [];

  if (prefs.mode === "improve") {
    parts.push(`acc:${min}..${max}`);
    if (prefs.staleDays > 0) parts.push(`NOT played:last${prefs.staleDays}d`);
  } else if (prefs.includeUnplayed) {
    if (prefs.staleDays > 0) {
      parts.push(
        `((acc:<${min} NOT played:last${prefs.staleDays}d) OR played:never)`,
      );
    } else {
      parts.push(`(acc:<${min} OR played:never)`);
    }
  } else {
    parts.push(`acc:<${min}`);
    if (prefs.staleDays > 0) parts.push(`NOT played:last${prefs.staleDays}d`);
  }

  const sMin = prefs.starsMin.trim();
  const sMax = prefs.starsMax.trim();
  if (sMin !== "" && sMax !== "") {
    parts.push(`stars:${sMin}..${sMax}`);
  } else if (sMin !== "") {
    parts.push(`stars>=${sMin}`);
  } else if (sMax !== "") {
    parts.push(`stars<=${sMax}`);
  }

  if (rulesetShortName) {
    parts.push(`mode:${rulesetShortName}`);
  }

  return parts.join(" ");
}

function loadPrefs(): UpNextPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS, query: buildQueryFromPresets(DEFAULT_PREFS, null) };
    const parsed = JSON.parse(raw) as Partial<UpNextPrefs>;
    const merged: UpNextPrefs = {
      ...DEFAULT_PREFS,
      ...parsed,
      mode: parsed.mode === "reach" ? "reach" : "improve",
      band:
        parsed.band === "93-97" || parsed.band === "custom"
          ? parsed.band
          : "90-93",
      staleDays: ([0, 7, 14, 30] as const).includes(parsed.staleDays as StaleDays)
        ? (parsed.staleDays as StaleDays)
        : 14,
      accMin: clampAcc(Number(parsed.accMin ?? 90)),
      accMax: clampAcc(Number(parsed.accMax ?? 93)),
      starsMin: typeof parsed.starsMin === "string" ? parsed.starsMin : "",
      starsMax: typeof parsed.starsMax === "string" ? parsed.starsMax : "",
      includeUnplayed: parsed.includeUnplayed !== false,
      query: typeof parsed.query === "string" ? parsed.query : "",
    };
    if (!merged.query.trim()) {
      merged.query = buildQueryFromPresets(merged, null);
    }
    return merged;
  } catch {
    return { ...DEFAULT_PREFS, query: buildQueryFromPresets(DEFAULT_PREFS, null) };
  }
}

function savePrefs(prefs: UpNextPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function openInPractice(query: string) {
  try {
    const raw = localStorage.getItem(PRACTICE_SEARCH_KEY);
    const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(
      PRACTICE_SEARCH_KEY,
      JSON.stringify({
        ...prev,
        q: query,
        page: 1,
      }),
    );
  } catch {
    localStorage.setItem(
      PRACTICE_SEARCH_KEY,
      JSON.stringify({ q: query, page: 1 }),
    );
  }
}

export function SessionUpNext({
  isIdle,
  rulesetShortName,
  excludeBeatmapIds,
}: {
  isIdle: boolean;
  rulesetShortName: string | null;
  excludeBeatmapIds: string[];
}) {
  const ratingMode = useRatingDisplayMode();
  const [prefs, setPrefs] = useState<UpNextPrefs>(() => loadPrefs());
  const [shuffleKey, setShuffleKey] = useState(0);
  const [queryDirty, setQueryDirty] = useState(false);

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (!rulesetShortName) return;
    setPrefs((prev) => {
      if (/\bmode:/i.test(prev.query)) return prev;
      const withoutMode = buildQueryFromPresets(prev, null);
      if (
        prev.query.trim() === withoutMode.trim() ||
        prev.query.trim() === ""
      ) {
        return {
          ...prev,
          query: buildQueryFromPresets(prev, rulesetShortName),
        };
      }
      return prev;
    });
  }, [rulesetShortName]);

  function patchPresets(patch: Partial<UpNextPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      if (!queryDirty) {
        next.query = buildQueryFromPresets(next, rulesetShortName);
      }
      return next;
    });
  }

  function resetFromPresets() {
    setQueryDirty(false);
    setPrefs((prev) => ({
      ...prev,
      query: buildQueryFromPresets(prev, rulesetShortName),
    }));
  }

  const sampleQuery = prefs.query.trim();

  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: [
      "practice-sample",
      sampleQuery,
      excludeBeatmapIds.join(","),
      shuffleKey,
    ],
    queryFn: () =>
      fetchPracticeSample({
        q: sampleQuery || undefined,
        count: 3,
        exclude: excludeBeatmapIds,
      }),
    enabled: sampleQuery.length > 0,
  });

  const items =
    data && !("error" in data) ? (data.items as PracticeItem[]) : [];
  const total = data && !("error" in data) ? data.total : 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
            Up next
          </h2>
          <p className="mt-1 text-sm text-muted">
            {isIdle
              ? "Pick a map to start — plays will open a live session after sync."
              : "Suggested maps for this session. Already-played maps are excluded."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rx-btn"
            onClick={() => {
              setShuffleKey((k) => k + 1);
              void refetch();
            }}
            disabled={isFetching || !sampleQuery}
          >
            {isFetching ? "Shuffling…" : "Shuffle"}
          </button>
          <Link
            to="/practice"
            className="rx-btn"
            onClick={() => openInPractice(sampleQuery)}
          >
            Open in Practice
          </Link>
        </div>
      </div>

      <div className="rx-panel space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: "improve" as const, label: "Improve" },
              { id: "reach" as const, label: "Reach" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              className={
                prefs.mode === m.id
                  ? "rx-chip bg-accent-glow text-accent"
                  : "rx-chip bg-elevated text-muted hover:text-ink"
              }
              onClick={() => patchPresets({ mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div>
          <div className="rx-label mb-2">Accuracy band</div>
          <div className="flex flex-wrap gap-2">
            {BANDS.map((b) => (
              <button
                key={b.id}
                type="button"
                className={
                  prefs.band === b.id
                    ? "rx-chip bg-accent-glow text-accent"
                    : "rx-chip bg-elevated text-muted hover:text-ink"
                }
                onClick={() =>
                  patchPresets({
                    band: b.id,
                    ...(b.id !== "custom"
                      ? { accMin: b.min, accMax: b.max }
                      : {}),
                  })
                }
              >
                {b.label}
              </button>
            ))}
          </div>
          {prefs.band === "custom" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className="rx-input w-24 rounded-lg"
                value={prefs.accMin}
                onChange={(e) =>
                  patchPresets({ accMin: Number(e.target.value) })
                }
                aria-label="Min accuracy %"
              />
              <span className="text-muted">–</span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className="rx-input w-24 rounded-lg"
                value={prefs.accMax}
                onChange={(e) =>
                  patchPresets({ accMax: Number(e.target.value) })
                }
                aria-label="Max accuracy %"
              />
              <span className="text-sm text-muted">%</span>
            </div>
          ) : null}
          <p className="mt-2 text-xs text-faint">
            {prefs.mode === "improve"
              ? "Maps whose best accuracy is in this band."
              : "Maps below the lower bound (aim to reach this band)."}
          </p>
        </div>

        {prefs.mode === "reach" ? (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={prefs.includeUnplayed}
              onChange={(e) =>
                patchPresets({ includeUnplayed: e.target.checked })
              }
              className="accent-(--color-accent)"
            />
            Include never played
          </label>
        ) : null}

        <div>
          <div className="rx-label mb-2">Not played since</div>
          <div className="flex flex-wrap gap-2">
            {STALE_OPTIONS.map((s) => (
              <button
                key={s.days}
                type="button"
                className={
                  prefs.staleDays === s.days
                    ? "rx-chip bg-accent-glow text-accent"
                    : "rx-chip bg-elevated text-muted hover:text-ink"
                }
                onClick={() => patchPresets({ staleDays: s.days })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="rx-label mb-2">Star range (optional)</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="Min"
              className="rx-input w-24 rounded-lg"
              value={prefs.starsMin}
              onChange={(e) => patchPresets({ starsMin: e.target.value })}
              aria-label="Min stars"
            />
            <span className="text-muted">–</span>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="Max"
              className="rx-input w-24 rounded-lg"
              value={prefs.starsMax}
              onChange={(e) => patchPresets({ starsMax: e.target.value })}
              aria-label="Max stars"
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rx-label">Query</span>
              <QueryLanguageHelpButton />
            </div>
            <button
              type="button"
              className="text-xs font-medium text-muted underline decoration-white/20 underline-offset-2 hover:text-accent"
              onClick={resetFromPresets}
            >
              Reset from presets
            </button>
          </div>
          <textarea
            className="rx-input min-h-18 w-full resize-y rounded-xl font-mono text-xs leading-relaxed"
            value={prefs.query}
            onChange={(e) => {
              setQueryDirty(true);
              setPrefs((prev) => ({ ...prev, query: e.target.value }));
            }}
            spellCheck={false}
            aria-label="Recommendation query"
          />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-rose-300">{error.message}</p>
      ) : null}

      {isLoading && items.length === 0 ? (
        <p className="text-sm text-muted">Finding maps…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">
          {sampleQuery
            ? "No maps match this query. Loosen the filters or edit the query."
            : "Enter a query to get recommendations."}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-faint">
            Showing {items.length} of {total.toLocaleString()} matches
          </p>
          <ul className="space-y-0.5">
            {items.map((item) => {
              const clientUrl = osuClientBeatmapUrl(item.onlineId);
              return (
                <li key={item.id} className="rx-row">
                  <Link
                    to="/practice/$beatmapId"
                    params={{ beatmapId: item.id }}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <BeatmapCover
                      backgroundFileHash={item.backgroundFileHash}
                      setOnlineId={item.setOnlineId}
                      size="list"
                      className="h-12 w-12 shrink-0 rounded shadow-md shadow-black/40"
                      alt=""
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-ink">
                        {item.title ?? "Untitled"}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-muted">
                        {item.artist ?? "Unknown"}
                        {item.difficultyName
                          ? ` · ${item.difficultyName}`
                          : ""}
                        {" · "}
                        {formatPrimaryRating({
                          mode: ratingMode,
                          starRating: item.starRating,
                          sunnyEstDiff: item.sunnyEstDiff,
                          sunnyStar: item.sunnyStar,
                        })}
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <div className="font-semibold tabular-nums text-ink">
                        {item.bestAccuracy != null
                          ? formatAccuracy(item.bestAccuracy)
                          : "—"}
                      </div>
                      <div className="text-xs tabular-nums text-muted">
                        {item.lastPlayedAt
                          ? formatRelativeTime(item.lastPlayedAt)
                          : "Never played"}
                      </div>
                    </div>
                  </Link>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <CopyBeatmapSearchButton
                      title={item.title}
                      difficultyName={item.difficultyName}
                      className="rx-btn"
                    />
                    {clientUrl ? (
                      <a href={clientUrl} className="rx-btn">
                        Open in osu!
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
