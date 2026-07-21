import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  fetchPracticeRecommend,
  type PracticeRecommend,
  type RecommendFocus,
  type RecommendSkillset,
} from "../../lib/api";
import { SessionSuggestMapRow } from "./SessionSuggestMapRow";

const PREFS_KEY = "rx-session-7k-recommend";

type RecPrefs = {
  focus: RecommendFocus;
  skillset: RecommendSkillset;
};

const DEFAULT_PREFS: RecPrefs = {
  focus: "push",
  skillset: "both",
};

const FOCUS_OPTIONS: { id: RecommendFocus; label: string; hint: string }[] = [
  {
    id: "push",
    label: "Push",
    hint: "Slightly above your 90–95% clear level on rice/LN/FLN (neighboring dans).",
  },
  {
    id: "accuracy",
    label: "Accuracy",
    hint: "Maps in your 99%+ difficulty range — aim for 99%+ on rice/LN/FLN.",
  },
  {
    id: "consistency",
    label: "Consistency",
    hint: "Maps around your 96–99% rice/LN/FLN level (farm / polish dans).",
  },
  {
    id: "deficit",
    label: "Deficit",
    hint: "Targets your weaker Rice, LN, or FLN axis.",
  },
  {
    id: "skillset",
    label: "Skillset",
    hint: "Focus Rice, LN, FLN, or all at your level.",
  },
];

const AXIS_OPTIONS: { id: RecommendSkillset; label: string }[] = [
  { id: "both", label: "All" },
  { id: "rc", label: "Rice" },
  { id: "ln", label: "LN" },
  { id: "fln", label: "FLN" },
];

function loadPrefs(): RecPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<RecPrefs>;
    return {
      focus:
        parsed.focus === "consistency" ||
        parsed.focus === "accuracy" ||
        parsed.focus === "deficit" ||
        parsed.focus === "skillset" ||
        parsed.focus === "push"
          ? parsed.focus
          : DEFAULT_PREFS.focus,
      skillset:
        parsed.skillset === "ln" ||
        parsed.skillset === "fln" ||
        parsed.skillset === "rc" ||
        parsed.skillset === "both"
          ? parsed.skillset
          : DEFAULT_PREFS.skillset,
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
}: {
  excludeBeatmapIds: string[];
}) {
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
        skillset: prefs.focus === "deficit" ? undefined : prefs.skillset,
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

        {prefs.focus !== "deficit" ? (
          <div>
            <div className="rx-label mb-2">Maps</div>
            <div className="flex flex-wrap gap-2">
              {AXIS_OPTIONS.map((s) => (
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
            <p className="mt-1.5 text-xs text-faint">
              LN is 20–80% long notes; FLN is ≥80% (full LN).
            </p>
          </div>
        ) : null}

        {skill ? (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <SkillStat
                label="Rice @ 90–95%"
                value={formatSkill(skill.peakRc)}
                note={`${skill.clearRcMaps ?? 0} maps · Push`}
              />
              <SkillStat
                label="LN @ 90–95%"
                value={formatSkill(skill.peakLn)}
                note={`${skill.clearLnMaps ?? 0} maps · Push`}
              />
              <SkillStat
                label="FLN @ 90–95%"
                value={formatSkill(skill.peakFln)}
                note={`${skill.clearFlnMaps ?? 0} maps · Push`}
              />
              <SkillStat
                label="Rice @ 99%+"
                value={formatSkill(skill.accuracyRc)}
                note={`${skill.accuracyRcMaps ?? 0} maps · Accuracy`}
              />
              <SkillStat
                label="LN @ 99%+"
                value={formatSkill(skill.accuracyLn)}
                note={`${skill.accuracyLnMaps ?? 0} maps · Accuracy`}
              />
              <SkillStat
                label="FLN @ 99%+"
                value={formatSkill(skill.accuracyFln)}
                note={`${skill.accuracyFlnMaps ?? 0} maps · Accuracy`}
              />
            </div>
            <p className="text-xs text-faint">
              Push aims ~8% above your 90–95% clears. Accuracy picks in your
              99%+ difficulty range.
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
              const relPct = ((item.relativeDifficulty - 1) * 100).toFixed(0);
              return (
                <SessionSuggestMapRow
                  key={item.id}
                  item={item}
                  metaExtra={
                    <>
                      {" · "}
                      <span className="tabular-nums">
                        {Number(relPct) >= 0 ? "+" : ""}
                        {relPct}% vs skill
                      </span>
                    </>
                  }
                  subtitle={item.reasoning}
                />
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
