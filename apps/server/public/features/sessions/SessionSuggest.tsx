import { useEffect, useState } from "react";
import { SessionUpNext } from "./SessionUpNext";
import { SessionSevenKRecommend } from "./SessionSevenKRecommend";
import { useAppDict } from "../../lib/i18n";

const PREFS_KEY = "rx-session-suggest-tab";

type SuggestTab = "up-next" | "7k";

const TABS: { id: SuggestTab; hint: string }[] = [
  {
    id: "up-next",
    hint: "Query-language filters for accuracy bands, staleness, and stars.",
  },
  {
    id: "7k",
    hint: "Ranked picks from your Sunny skill estimate (Push, Accuracy, Consistency, Deficit, Skillset).",
  },
];

function loadTab(): SuggestTab {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw === "7k" || raw === "up-next") return raw;
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

  const active = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const activeHint =
    tab === "up-next"
      ? dict?.session.suggestTabs.upNextHint
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
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={
              tab === t.id
                ? "rx-chip bg-accent-glow text-accent"
                : "rx-chip bg-elevated text-muted hover:text-ink"
            }
            onClick={() => setTab(t.id)}
          >
            {t.id === "up-next"
              ? dict?.session.suggestTabs.upNext
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
          <SessionSevenKRecommend excludeBeatmapIds={excludeBeatmapIds} />
        )}
      </div>
    </section>
  );
}
