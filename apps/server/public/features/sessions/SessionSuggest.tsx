import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlayedKeyModes } from "../../lib/api";
import { useAppDict, t } from "../../lib/i18n";
import { SessionUpNext } from "./SessionUpNext";
import { SessionSevenKRecommend } from "./SessionSevenKRecommend";

const PREFS_KEY = "rx-session-suggest-tab";
const CHIP_LIMIT = 6;
const FALLBACK_KEY_COUNTS = [4, 7];

type SuggestTab = "up-next" | number;

function parseStoredTab(raw: string | null): SuggestTab | null {
  if (raw == null) return null;
  if (raw === "up-next") return "up-next";
  if (raw === "7k") return 7;
  if (raw === "4k") return 4;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 18) return Math.round(n);
  return null;
}

function loadTab(keyCounts: number[]): SuggestTab {
  try {
    const stored = parseStoredTab(localStorage.getItem(PREFS_KEY));
    if (stored === "up-next") return "up-next";
    if (typeof stored === "number" && keyCounts.includes(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "up-next";
}

export function SessionSuggest({
  rulesetShortName,
  excludeBeatmapIds,
}: {
  rulesetShortName: string | null;
  excludeBeatmapIds: string[];
}) {
  const { dict } = useAppDict();
  const keysQuery = useQuery({
    queryKey: ["stats", "key-counts"],
    queryFn: fetchPlayedKeyModes,
    staleTime: 5 * 60_000,
  });
  const keyCounts =
    keysQuery.data?.keyCounts ??
    (keysQuery.isError ? FALLBACK_KEY_COUNTS : null);
  const [tab, setTab] = useState<SuggestTab | null>(null);

  useEffect(() => {
    if (!keyCounts) return;
    setTab((current) => {
      if (current === "up-next") return current;
      if (typeof current === "number" && keyCounts.includes(current)) {
        return current;
      }
      return loadTab(keyCounts);
    });
  }, [keyCounts]);

  useEffect(() => {
    if (tab == null) return;
    try {
      localStorage.setItem(PREFS_KEY, String(tab));
    } catch {
      /* ignore */
    }
  }, [tab]);

  const activeKey = typeof tab === "number" ? tab : null;
  const visibleTab = tab ?? "up-next";
  const activeHint =
    visibleTab === "up-next"
      ? dict?.session.suggestTabs.upNextHint
      : dict?.session.suggestTabs.keyHint ??
        dict?.session.suggestTabs.sevenKHint;

  const useSelect = (keyCounts?.length ?? 0) > CHIP_LIMIT;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-bold tracking-tight text-ink">
          {dict?.session.suggestTitle}
        </h2>
        <p className="mt-1 text-sm text-muted">{activeHint}</p>
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label={dict?.session.suggestionModeAria}
      >
        <button
          type="button"
          role="tab"
          aria-selected={visibleTab === "up-next"}
          className={
            visibleTab === "up-next"
              ? "rx-chip bg-accent-glow text-accent"
              : "rx-chip bg-elevated text-muted hover:text-ink"
          }
          onClick={() => setTab("up-next")}
        >
          {dict?.session.suggestTabs.upNext}
        </button>
        {keyCounts && useSelect ? (
          <select
            className="rx-select"
            aria-label={dict?.session.suggestionModeAria}
            value={activeKey ?? ""}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) setTab(next);
            }}
          >
            <option value="" disabled>
              {dict?.session.suggestTabs.keyHint ?? "Key count"}
            </option>
            {keyCounts.map((keyCount) => (
              <option key={keyCount} value={keyCount}>
                {t(dict?.session.suggestTabs.key, { keyCount }) ||
                  `${keyCount}K`}
              </option>
            ))}
          </select>
        ) : (
          keyCounts?.map((keyCount) => (
            <button
              key={keyCount}
              type="button"
              role="tab"
              aria-selected={tab === keyCount}
              className={
                tab === keyCount
                  ? "rx-chip bg-accent-glow text-accent"
                  : "rx-chip bg-elevated text-muted hover:text-ink"
              }
              onClick={() => setTab(keyCount)}
            >
              {t(dict?.session.suggestTabs.key, { keyCount }) || `${keyCount}K`}
            </button>
          ))
        )}
      </div>

      <div role="tabpanel">
        {visibleTab === "up-next" || activeKey == null ? (
          <SessionUpNext
            rulesetShortName={rulesetShortName}
            excludeBeatmapIds={excludeBeatmapIds}
          />
        ) : (
          <SessionSevenKRecommend
            key={activeKey}
            keyCount={activeKey}
            excludeBeatmapIds={excludeBeatmapIds}
          />
        )}
      </div>
    </section>
  );
}
