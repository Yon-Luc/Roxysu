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
  "online-score-pull": "setup",
  "score-transfer": "setup",
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
  "rework-dan-calculation": "jobs",
  "pattern-analysis": "jobs",
  "mania-rating-lab": "jobs",
};

/** Sections shown as jump links under the active Settings tab, in page order. */
export const TAB_SECTIONS: Record<
  SettingsTabId,
  { id: string; labelKey: string; desktopHidden?: boolean }[]
> = {
  setup: [
    { id: "osu-lazer-data-folder", labelKey: "lazerDataFolder" },
    { id: "live-sync", labelKey: "liveSync" },
    { id: "online-score-pull", labelKey: "onlineScorePull" },
    { id: "score-transfer", labelKey: "scoreTransfer" },
    { id: "in-game-overlay", labelKey: "overlayHost" },
    { id: "tosu-live-map", labelKey: "tosuLiveMap" },
  ],
  practice: [
    { id: "mastery-formula", labelKey: "masteryFormula" },
    { id: "score-username", labelKey: "scoreUsername" },
    { id: "gamemode", labelKey: "gamemode" },
  ],
  customize: [
    { id: "axis-thresholds", labelKey: "axisThresholds" },
    { id: "recommend-focus", labelKey: "recommendFocus" },
  ],
  appearance: [
    { id: "appearance", labelKey: "appearance" },
    { id: "difficulty-display", labelKey: "difficultyDisplay" },
    { id: "preview-skin", labelKey: "previewSkin" },
    { id: "keybinds", labelKey: "keybinds" },
  ],
  jobs: [
    { id: "sunny-dan-calculation", labelKey: "sunnyDan" },
    { id: "daniel-dan-calculation", labelKey: "danielDan" },
    { id: "rework-dan-calculation", labelKey: "reworkDan" },
    { id: "pattern-analysis", labelKey: "patternAnalysis" },
    { id: "mania-rating-lab", labelKey: "maniaRatingLab", desktopHidden: true },
  ],
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
