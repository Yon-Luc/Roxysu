import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  fetchPracticeRecommend,
  type PracticeRecommend,
  type RecommendFocus,
  type RecommendSkillset,
} from "../../lib/api";
import {
  formatSkillRating,
  useRatingDisplayMode,
} from "../../lib/ratingDisplay";
import { readSkillTopPlays, SKILL_TOP_PLAYS_STORAGE_KEY } from "../../lib/skillTopPlays";
import { useAppDict, t } from "../../lib/i18n";
import type { Dictionary } from "@roxysu/i18n";
import { SessionSuggestMapRow } from "./SessionSuggestMapRow";

type RecommendKeyCount = 4 | 7;

function prefsKey(keyCount: RecommendKeyCount): string {
  return `rx-session-${keyCount}k-recommend`;
}

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
    hint: "Slightly above your 90%+ clear level on rice/LN/FLN (neighboring dans).",
  },
  {
    id: "accuracy",
    label: "Accuracy",
    hint: "Maps in your 99%+ difficulty range — aim for 99%+ on rice/LN/FLN.",
  },
  {
    id: "consistency",
    label: "Consistency",
    hint: "Maps around your 96%+ rice/LN/FLN level (farm / polish dans).",
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

function loadPrefs(keyCount: RecommendKeyCount): RecPrefs {
  try {
    const raw = localStorage.getItem(prefsKey(keyCount));
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

function savePrefs(keyCount: RecommendKeyCount, prefs: RecPrefs) {
  localStorage.setItem(prefsKey(keyCount), JSON.stringify(prefs));
}

export function SessionSevenKRecommend({
  keyCount = 7,
  excludeBeatmapIds,
}: {
  keyCount?: RecommendKeyCount;
  excludeBeatmapIds: string[];
}) {
  const { dict } = useAppDict();
  const ratingMode = useRatingDisplayMode();
  const [prefs, setPrefs] = useState<RecPrefs>(() => loadPrefs(keyCount));
  const [shuffleKey, setShuffleKey] = useState(0);
  const [skillTopPlays, setSkillTopPlays] = useState(() => readSkillTopPlays());
  const excludeRef = useRef(excludeBeatmapIds);
  excludeRef.current = excludeBeatmapIds;

  useEffect(() => {
    savePrefs(keyCount, prefs);
  }, [keyCount, prefs]);

  useEffect(() => {
    const syncTopPlays = () => setSkillTopPlays(readSkillTopPlays());
    const onStorage = (e: StorageEvent) => {
      if (e.key === SKILL_TOP_PLAYS_STORAGE_KEY) syncTopPlays();
    };
    window.addEventListener("focus", syncTopPlays);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", syncTopPlays);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: [
      "practice-recommend",
      keyCount,
      prefs.focus,
      prefs.skillset,
      skillTopPlays,
      shuffleKey,
    ],
    queryFn: () =>
      fetchPracticeRecommend({
        focus: prefs.focus,
        skillset: prefs.focus === "deficit" ? undefined : prefs.skillset,
        count: 8,
        exclude: excludeRef.current,
        topPlays: skillTopPlays,
        keyCount,
      }),
  });

  const batch =
    data && !("error" in data) ? (data as PracticeRecommend) : null;
  const items = batch?.recommendations ?? [];
  const skill = batch?.skill;
  const requiredMaps = batch?.skillTopPlays ?? skillTopPlays;
  const focusHint =
    dict?.session.focus[`${prefs.focus}Hint` as "pushHint"] ??
    FOCUS_OPTIONS.find((f) => f.id === prefs.focus)?.hint ??
    "";

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
          {isFetching
            ? (dict?.session.refreshing ?? "Refreshing…")
            : (dict?.session.refresh ?? "Refresh")}
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
              {dict?.session.focus[m.id] ?? m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-faint">{focusHint}</p>

        {prefs.focus !== "deficit" ? (
          <div>
            <div className="rx-label mb-2">
              {dict?.session.mapsLabel ?? "Maps"}
            </div>
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
                  {
                    {
                      both: dict?.stats.axisAll ?? "All",
                      rc: dict?.stats.axisRice ?? "Rice",
                      ln: dict?.stats.axisLn ?? "LN",
                      fln: dict?.stats.axisFln ?? "FLN",
                    }[s.id]
                  }
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-faint">
              {dict?.session.lnFlnHint ??
                "LN is 20–80% long notes; FLN is ≥80% (full LN)."}
            </p>
          </div>
        ) : null}

        {skill ? (
          <div className="space-y-2">
            <p className="text-xs text-faint">
              {(() => {
                const parts = (
                  t(dict?.session.skillFromTop, { required: requiredMaps }) ||
                  t(
                    "Skill from your top {{required}} rated maps per band (best play per map; all {{required}} required). Change on ⟦STATS⟧.",
                    { required: requiredMaps },
                  )
                ).split("⟦STATS⟧");
                return (
                  <>
                    {parts[0]}
                    <Link
                      to="/stats"
                      search={{
                        granularity: "day",
                        range: 30,
                        skillTopPlays,
                        skillAxis: "all",
                        keyCount,
                      }}
                      className="underline hover:text-accent"
                    >
                      Stats
                    </Link>
                    {parts[1]}
                  </>
                );
              })()}
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <SkillStat
                label={
                  t(dict?.session.skillStat, {
                    axis: dict?.stats.axisRice ?? "Rice",
                    acc: 90,
                  }) || "Rice @ 90%+"
                }
                value={formatSkillRating({
                  mode: ratingMode,
                  sunnyStar: skill.peakRc,
                  axis: "rc",
                })}
                note={bandMapsNote(skill.peakRc, skill.clearRcMaps ?? 0, requiredMaps, dict?.session.focus.push ?? "Push", dict)}
              />
              <SkillStat
                label={
                  t(dict?.session.skillStat, {
                    axis: dict?.stats.axisLn ?? "LN",
                    acc: 90,
                  }) || "LN @ 90%+"
                }
                value={formatSkillRating({
                  mode: ratingMode,
                  sunnyStar: skill.peakLn,
                  axis: "ln",
                })}
                note={bandMapsNote(skill.peakLn, skill.clearLnMaps ?? 0, requiredMaps, dict?.session.focus.push ?? "Push", dict)}
              />
              <SkillStat
                label={
                  t(dict?.session.skillStat, {
                    axis: dict?.stats.axisFln ?? "FLN",
                    acc: 90,
                  }) || "FLN @ 90%+"
                }
                value={formatSkillRating({
                  mode: ratingMode,
                  sunnyStar: skill.peakFln,
                  axis: "fln",
                })}
                note={bandMapsNote(skill.peakFln, skill.clearFlnMaps ?? 0, requiredMaps, dict?.session.focus.push ?? "Push", dict)}
              />
              <SkillStat
                label={
                  t(dict?.session.skillStat, {
                    axis: dict?.stats.axisRice ?? "Rice",
                    acc: 99,
                  }) || "Rice @ 99%+"
                }
                value={formatSkillRating({
                  mode: ratingMode,
                  sunnyStar: skill.accuracyRc,
                  axis: "rc",
                })}
                note={bandMapsNote(
                  skill.accuracyRc,
                  skill.accuracyRcMaps ?? 0,
                  requiredMaps,
                  dict?.session.focus.accuracy ?? "Accuracy",
                  dict,
                )}
              />
              <SkillStat
                label={
                  t(dict?.session.skillStat, {
                    axis: dict?.stats.axisLn ?? "LN",
                    acc: 99,
                  }) || "LN @ 99%+"
                }
                value={formatSkillRating({
                  mode: ratingMode,
                  sunnyStar: skill.accuracyLn,
                  axis: "ln",
                })}
                note={bandMapsNote(
                  skill.accuracyLn,
                  skill.accuracyLnMaps ?? 0,
                  requiredMaps,
                  dict?.session.focus.accuracy ?? "Accuracy",
                  dict,
                )}
              />
              <SkillStat
                label={
                  t(dict?.session.skillStat, {
                    axis: dict?.stats.axisFln ?? "FLN",
                    acc: 99,
                  }) || "FLN @ 99%+"
                }
                value={formatSkillRating({
                  mode: ratingMode,
                  sunnyStar: skill.accuracyFln,
                  axis: "fln",
                })}
                note={bandMapsNote(
                  skill.accuracyFln,
                  skill.accuracyFlnMaps ?? 0,
                  requiredMaps,
                  dict?.session.focus.accuracy ?? "Accuracy",
                  dict,
                )}
              />
            </div>
            <p className="text-xs text-faint">
              {dict?.session.pushAccuracyHint ??
                "Push aims ~8% above your 90%+ clears. Accuracy picks in your 99%+ difficulty range."}
            </p>
          </div>
        ) : null}

        {batch?.needsSunnyBackfill ? (
          <p className="text-xs text-warning/90">
            {(() => {
              const parts = (
                t(dict?.session.needsSunnyBackfill, { keymode: keyCount }) ||
                t(
                  "Some mania maps still need Sunny dan ratings. Run backfill in ⟦SETTINGS⟧ for better {{keymode}}K recommendations.",
                  { keymode: keyCount },
                )
              ).split("⟦SETTINGS⟧");
              return (
                <>
                  {parts[0]}
                  <Link to="/settings" className="underline hover:text-accent">
                    Settings
                  </Link>
                  {parts[1]}
                </>
              );
            })()}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-danger">{error.message}</p>
      ) : null}

      {isLoading && items.length === 0 ? (
        <p className="text-sm text-muted">
          {dict?.session.estimating ?? "Estimating skill and ranking maps…"}
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">
          {batch?.summary ??
            (t(dict?.session.noRecommendations, { keymode: keyCount }) ||
              t(
                "No recommendations yet. Play more {{keymode}}K maps or backfill Sunny ratings.",
                { keymode: keyCount },
              ))}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-faint">
            {batch?.summary}
            {batch
              ? ` · ${
                  t(dict?.session.mapsWithSunny, {
                    count: batch.totalMapsConsidered.toLocaleString(),
                    keymode: keyCount,
                  }) ||
                  `${batch.totalMapsConsidered.toLocaleString()} ${keyCount}K maps with Sunny`
                }`
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
                        {t(dict?.session.vsSkill, { pct: relPct }) ||
                          `${relPct}% vs skill`}
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

function bandMapsNote(
  value: number,
  maps: number,
  requiredMaps: number,
  band: string,
  dict: Dictionary["app"] | undefined,
): string {
  if (maps === 0)
    return t(dict?.session.bandNoMaps, { band }) || `No maps in band · ${band}`;
  if (value > 0)
    return t(dict?.session.bandMaps, { maps, band }) || `${maps} maps in band · ${band}`;
  return (
    t(dict?.session.bandMapsPartial, { maps, required: requiredMaps, band }) ||
    `${maps}/${requiredMaps} maps in band · ${band}`
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
