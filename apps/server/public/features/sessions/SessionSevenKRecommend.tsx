import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { BeatmapCover } from "../../components/BeatmapCover";
import { CopyBeatmapSearchButton } from "../../components/CopyBeatmapSearchButton";
import {
  fetchPracticeRecommend,
  type PracticeRecommend,
  type RecommendFocus,
  type RecommendSkillset,
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

const PREFS_KEY = "rx-session-7k-recommend";

type RecPrefs = {
  focus: RecommendFocus;
  skillset: RecommendSkillset;
};

const DEFAULT_PREFS: RecPrefs = {
  focus: "push",
  skillset: "rc",
};

const FOCUS_OPTIONS: { id: RecommendFocus; label: string; hint: string }[] = [
  {
    id: "push",
    label: "Push",
    hint: "Slightly above your 90–95% clear level on rice/LN (neighboring dans).",
  },
  {
    id: "consistency",
    label: "Consistency",
    hint: "Maps around your 96–99% rice/LN level (farm / polish dans).",
  },
  {
    id: "deficit",
    label: "Deficit",
    hint: "Targets your weaker RC or LN axis.",
  },
  {
    id: "skillset",
    label: "Skillset",
    hint: "Focus RC or LN maps at your level.",
  },
];

function loadPrefs(): RecPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<RecPrefs>;
    return {
      focus:
        parsed.focus === "consistency" ||
        parsed.focus === "deficit" ||
        parsed.focus === "skillset" ||
        parsed.focus === "push"
          ? parsed.focus
          : DEFAULT_PREFS.focus,
      skillset: parsed.skillset === "ln" ? "ln" : "rc",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: RecPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function formatSkill(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${n.toFixed(1)}★`;
}

export function SessionSevenKRecommend({
  excludeBeatmapIds,
  embedded = false,
}: {
  excludeBeatmapIds: string[];
  /** When true, omit the outer section title (parent provides tabs). */
  embedded?: boolean;
}) {
  const ratingMode = useRatingDisplayMode();
  const [prefs, setPrefs] = useState<RecPrefs>(() => loadPrefs());
  const [shuffleKey, setShuffleKey] = useState(0);

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: [
      "practice-recommend-7k",
      prefs.focus,
      prefs.skillset,
      excludeBeatmapIds.join(","),
      shuffleKey,
    ],
    queryFn: () =>
      fetchPracticeRecommend({
        focus: prefs.focus,
        skillset: prefs.focus === "skillset" ? prefs.skillset : undefined,
        count: 8,
        exclude: excludeBeatmapIds,
      }),
  });

  const batch =
    data && !("error" in data) ? (data as PracticeRecommend) : null;
  const items = batch?.recommendations ?? [];
  const skill = batch?.skill;
  const focusHint =
    FOCUS_OPTIONS.find((f) => f.id === prefs.focus)?.hint ?? "";

  return (
    <section className="space-y-4">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="rx-btn"
            onClick={() => {
              setShuffleKey((k) => k + 1);
              void refetch();
            }}
            disabled={isFetching}
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
              7K recommendations
            </h2>
            <p className="mt-1 text-sm text-muted">
              Companella-style picks from your library using Sunny skill and RC/LN
              axes.
            </p>
          </div>
          <button
            type="button"
            className="rx-btn"
            onClick={() => {
              setShuffleKey((k) => k + 1);
              void refetch();
            }}
            disabled={isFetching}
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}

      <div className="rx-panel space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          {FOCUS_OPTIONS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={
                prefs.focus === m.id
                  ? "rx-chip bg-accent-glow text-accent"
                  : "rx-chip bg-elevated text-muted hover:text-ink"
              }
              onClick={() => setPrefs((prev) => ({ ...prev, focus: m.id }))}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-faint">{focusHint}</p>

        {prefs.focus === "skillset" ? (
          <div>
            <div className="rx-label mb-2">Skill axis</div>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "rc" as const, label: "RC" },
                  { id: "ln" as const, label: "LN" },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={
                    prefs.skillset === s.id
                      ? "rx-chip bg-accent-glow text-accent"
                      : "rx-chip bg-elevated text-muted hover:text-ink"
                  }
                  onClick={() =>
                    setPrefs((prev) => ({ ...prev, skillset: s.id }))
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {skill ? (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <SkillStat
                label="RC @ 90–95%"
                value={formatSkill(skill.peakRc)}
                note={`${skill.clearRcMaps ?? 0} maps · Push`}
              />
              <SkillStat
                label="LN @ 90–95%"
                value={formatSkill(skill.peakLn)}
                note={`${skill.clearLnMaps ?? 0} maps · Push`}
              />
              <SkillStat
                label="RC @ 96–99%"
                value={formatSkill(skill.consistencyRc)}
                note={`${skill.consistencyRcMaps ?? 0} maps · Consistency`}
              />
              <SkillStat
                label="LN @ 96–99%"
                value={formatSkill(skill.consistencyLn)}
                note={`${skill.consistencyLnMaps ?? 0} maps · Consistency`}
              />
            </div>
            <p className="text-xs text-faint">
              Push aims ~8% above your 90–95% clears. Consistency picks around
              your 96–99% dan level.
            </p>
          </div>
        ) : null}

        {batch?.needsSunnyBackfill ? (
          <p className="text-xs text-amber-200/90">
            Some mania maps still need Sunny dan ratings. Run backfill in{" "}
            <Link to="/settings" className="underline hover:text-accent">
              Settings
            </Link>{" "}
            for better 7K recommendations.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-rose-300">{error.message}</p>
      ) : null}

      {isLoading && items.length === 0 ? (
        <p className="text-sm text-muted">Estimating skill and ranking maps…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">
          {batch?.summary ??
            "No recommendations yet. Play more 7K maps or backfill Sunny ratings."}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-faint">
            {batch?.summary}
            {batch
              ? ` · ${batch.totalMapsConsidered.toLocaleString()} 7K maps with Sunny`
              : ""}
          </p>
          <ul className="space-y-0.5">
            {items.map((item) => {
              const clientUrl = osuClientBeatmapUrl(item.onlineId);
              const relPct = ((item.relativeDifficulty - 1) * 100).toFixed(0);
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
                        {" · "}
                        <span className="tabular-nums">
                          {Number(relPct) >= 0 ? "+" : ""}
                          {relPct}% vs skill
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-faint">
                        {item.reasoning}
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

function SkillStat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg bg-elevated/60 px-3 py-2">
      <div className="rx-label">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold tabular-nums text-ink">
        {value}
      </div>
      <div className="text-xs text-faint">{note}</div>
    </div>
  );
}
