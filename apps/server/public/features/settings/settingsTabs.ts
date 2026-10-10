export const SETTINGS_TAB_IDS = [
  "setup",
  "practice",
  "customize",
  "appearance",
  "jobs",
] as const;

export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

export type SettingsTabDef = {
  id: SettingsTabId;
  /** Key under `settings.tabs` in the app dictionary. */
  labelKey: SettingsTabId;
};

export const SETTINGS_TABS: SettingsTabDef[] = [
  { id: "setup", labelKey: "setup" },
  { id: "practice", labelKey: "practice" },
  { id: "customize", labelKey: "customize" },
  { id: "appearance", labelKey: "appearance" },
  { id: "jobs", labelKey: "jobs" },
];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "setup";

/** Maps `?section=` / DOM section ids to the Settings tab that owns them. */
export const SECTION_TO_TAB: Record<string, SettingsTabId> = {
  "osu-lazer-data-folder": "setup",
  "live-sync": "setup",
  "in-game-overlay": "setup",
  "tosu-live-map": "setup",
  "mastery-formula": "practice",
  "score-username": "practice",
  gamemode: "practice",
  "axis-thresholds": "customize",
  "recommend-focus": "customize",
  appearance: "appearance",
  "difficulty-display": "appearance",
  "preview-skin": "appearance",
  keybinds: "appearance",
  "sunny-dan-calculation": "jobs",
  "daniel-dan-calculation": "jobs",
  "pattern-analysis": "jobs",
  "mania-rating-lab": "jobs",
};

export function isSettingsTabId(value: string): value is SettingsTabId {
  return (SETTINGS_TAB_IDS as readonly string[]).includes(value);
}

export function resolveSettingsTab(
  section?: string,
  tab?: string,
): SettingsTabId {
  if (section) {
    const fromSection = SECTION_TO_TAB[section];
    if (fromSection) return fromSection;
  }
  if (tab && isSettingsTabId(tab)) return tab;
  return DEFAULT_SETTINGS_TAB;
}
