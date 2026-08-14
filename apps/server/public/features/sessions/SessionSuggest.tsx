import { useEffect, useState } from "react";
import { SessionUpNext } from "./SessionUpNext";
import { SessionSevenKRecommend } from "./SessionSevenKRecommend";
import { useAppDict } from "../../lib/i18n";

const PREFS_KEY = "rx-session-suggest-tab";

type SuggestTab = "up-next" | "7k" | "4k";

const TABS: SuggestTab[] = ["up-next", "7k", "4k"];

function loadTab(): SuggestTab {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw === "7k" || raw === "4k" || raw === "up-next") return raw;
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
  const [tab, setTab] = useState<SuggestTab>(() => loadTab());
  const { dict } = useAppDict();

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, tab);
  }, [tab]);

  const activeHint =
    tab === "up-next"
      ? dict?.session.suggestTabs.upNextHint
      : tab === "4k"
        ? dict?.session.suggestTabs.fourKHint
        : dict?.session.suggestTabs.sevenKHint;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
          {dict?.session.suggestTitle}
        </h2>
        <p className="mt-1 text-sm text-muted">{activeHint}</p>
      </div>

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label={dict?.session.suggestionModeAria}
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={
              tab === id
                ? "rx-chip bg-accent-glow text-accent"
                : "rx-chip bg-elevated text-muted hover:text-ink"
            }
            onClick={() => setTab(id)}
          >
            {id === "up-next"
              ? dict?.session.suggestTabs.upNext
              : id === "4k"
                ? dict?.session.suggestTabs.fourK
                : dict?.session.suggestTabs.sevenK}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "up-next" ? (
          <SessionUpNext
            rulesetShortName={rulesetShortName}
            excludeBeatmapIds={excludeBeatmapIds}
          />
        ) : (
          <SessionSevenKRecommend
            key={tab === "4k" ? 4 : 7}
            keyCount={tab === "4k" ? 4 : 7}
            excludeBeatmapIds={excludeBeatmapIds}
          />
        )}
      </div>
    </section>
  );
}
