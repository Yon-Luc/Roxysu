import {
  migratePreviewScroll,
  PREVIEW_SCROLL_DEFAULT,
} from "../lib/paintManiaNotefield";
import {
  ACCURACY_X_DEFAULT,
  ACCURACY_Y_DEFAULT,
  COMBO_X_DEFAULT,
  COMBO_Y_DEFAULT,
  COUNTER_X_DEFAULT,
  COUNTER_Y_DEFAULT,
} from "./JudgmentCounterOverlay";
import {
  TIMING_VIS_X_DEFAULT,
  TIMING_VIS_Y_DEFAULT,
} from "./TimingVisualizer";
import type { JudgmentSummary } from "../lib/maniaWindows";
import { clamp } from "../lib/format";
import {
  KEYMODES,
  nearestKeymode,
  type Keymode,
} from "../lib/previewSkin";

export { nearestKeymode };

export const PREFS_KEY = "rx-beatmap-preview";
export const SKIP_MS = 5000;
export const PRESET_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
/** Playfield width as % of the stage (saved). */
export const FIELD_WIDTH_MIN = 15;
export const FIELD_WIDTH_MAX = 100;
export const FIELD_WIDTH_DEFAULT = 55;

export type PreviewRuleset = "osu" | "taiko" | "fruits" | "mania";

export type ManiaPlayfieldPrefs = {
  fieldWidth: number;
  scroll: number;
};

export type RulesetFieldWidth = {
  fieldWidth: number;
};

export type PreviewPlayfieldPrefs = {
  osu: RulesetFieldWidth;
  taiko: RulesetFieldWidth;
  fruits: RulesetFieldWidth;
  mania: Record<Keymode, ManiaPlayfieldPrefs>;
};

export type PreviewPrefs = {
  volume: number;
  rate: number;
  fullscreen: boolean;
  playfield: PreviewPlayfieldPrefs;
  /** Timing visualizer center X (% of playfield). */
  timingX: number;
  /** Timing visualizer center Y (% of playfield). */
  timingY: number;
  /** Judgment counter center X (% of playfield). */
  counterX: number;
  /** Judgment counter center Y (% of playfield). */
  counterY: number;
  /** Combo chip center X (% of playfield). */
  comboX: number;
  /** Combo chip center Y (% of playfield). */
  comboY: number;
  /** Accuracy chip center X (% of playfield). */
  accuracyX: number;
  /** Accuracy chip center Y (% of playfield). */
  accuracyY: number;
  /** Solid black backdrop while in Play mode. */
  blackBg: boolean;
  /** Opt-in miss/timing/pattern tools. Default off. */
  analysis: boolean;
};

function defaultManiaSlot(
  fieldWidth = FIELD_WIDTH_DEFAULT,
  scroll = PREVIEW_SCROLL_DEFAULT,
): ManiaPlayfieldPrefs {
  return { fieldWidth, scroll };
}

function defaultManiaPlayfield(
  fieldWidth = FIELD_WIDTH_DEFAULT,
  scroll = PREVIEW_SCROLL_DEFAULT,
): Record<Keymode, ManiaPlayfieldPrefs> {
  return {
    4: defaultManiaSlot(fieldWidth, scroll),
    6: defaultManiaSlot(fieldWidth, scroll),
    7: defaultManiaSlot(fieldWidth, scroll),
    8: defaultManiaSlot(fieldWidth, scroll),
    9: defaultManiaSlot(fieldWidth, scroll),
    10: defaultManiaSlot(fieldWidth, scroll),
  };
}

export function defaultPlayfieldPrefs(
  fieldWidth = FIELD_WIDTH_DEFAULT,
  scroll = PREVIEW_SCROLL_DEFAULT,
): PreviewPlayfieldPrefs {
  return {
    osu: { fieldWidth },
    taiko: { fieldWidth },
    fruits: { fieldWidth },
    mania: defaultManiaPlayfield(fieldWidth, scroll),
  };
}

export const DEFAULT_PREFS: PreviewPrefs = {
  volume: 0.85,
  rate: 1,
  fullscreen: false,
  playfield: defaultPlayfieldPrefs(),
  timingX: TIMING_VIS_X_DEFAULT,
  timingY: TIMING_VIS_Y_DEFAULT,
  counterX: COUNTER_X_DEFAULT,
  counterY: COUNTER_Y_DEFAULT,
  comboX: COMBO_X_DEFAULT,
  comboY: COMBO_Y_DEFAULT,
  accuracyX: ACCURACY_X_DEFAULT,
  accuracyY: ACCURACY_Y_DEFAULT,
  blackBg: false,
  analysis: false,
};

export const EMPTY_SUMMARY: JudgmentSummary = {
  accuracy: 1,
  combo: 0,
  maxCombo: 0,
  counts: {
    perfect: 0,
    great: 0,
    good: 0,
    ok: 0,
    meh: 0,
    miss: 0,
  },
};

export function clampRate(rate: number): number {
  return clamp(rate, 0.5, 2);
}

export function clampFieldWidth(value: number): number {
  return clamp(value, FIELD_WIDTH_MIN, FIELD_WIDTH_MAX);
}

function hudX(value: unknown, fallback: number): number {
  return clamp(typeof value === "number" ? value : fallback, -1000, 1100);
}

function hudY(value: unknown, fallback: number): number {
  return clamp(typeof value === "number" ? value : fallback, 0, 100);
}

export function isPreviewRuleset(value: unknown): value is PreviewRuleset {
  return (
    value === "osu" ||
    value === "taiko" ||
    value === "fruits" ||
    value === "mania"
  );
}

function parseFieldWidth(value: unknown, fallback: number): number {
  return clampFieldWidth(typeof value === "number" ? value : fallback);
}

function parseManiaSlot(
  raw: unknown,
  fallbackWidth: number,
  fallbackScroll: number,
): ManiaPlayfieldPrefs {
  if (!raw || typeof raw !== "object") {
    return defaultManiaSlot(fallbackWidth, fallbackScroll);
  }
  const slot = raw as Partial<ManiaPlayfieldPrefs>;
  return {
    fieldWidth: parseFieldWidth(slot.fieldWidth, fallbackWidth),
    scroll: migratePreviewScroll(
      typeof slot.scroll === "number" ? slot.scroll : fallbackScroll,
    ),
  };
}

function parsePlayfield(
  raw: unknown,
  legacyFieldWidth: number,
  legacyScroll: number,
): PreviewPlayfieldPrefs {
  const defaults = defaultPlayfieldPrefs(legacyFieldWidth, legacyScroll);
  if (!raw || typeof raw !== "object") return defaults;
  const p = raw as Partial<PreviewPlayfieldPrefs> & {
    osu?: Partial<RulesetFieldWidth>;
    taiko?: Partial<RulesetFieldWidth>;
    fruits?: Partial<RulesetFieldWidth>;
    mania?: Partial<Record<string, unknown>>;
  };
  const mania = { ...defaults.mania };
  for (const keys of KEYMODES) {
    mania[keys] = parseManiaSlot(
      p.mania?.[String(keys)],
      legacyFieldWidth,
      legacyScroll,
    );
  }
  return {
    osu: {
      fieldWidth: parseFieldWidth(p.osu?.fieldWidth, legacyFieldWidth),
    },
    taiko: {
      fieldWidth: parseFieldWidth(p.taiko?.fieldWidth, legacyFieldWidth),
    },
    fruits: {
      fieldWidth: parseFieldWidth(p.fruits?.fieldWidth, legacyFieldWidth),
    },
    mania,
  };
}

export function resolveManiaPlayfield(
  prefs: PreviewPrefs,
  columnCount: number,
): ManiaPlayfieldPrefs {
  return prefs.playfield.mania[nearestKeymode(columnCount)];
}

export function resolveManiaScroll(
  prefs: PreviewPrefs,
  columnCount: number,
): number {
  return resolveManiaPlayfield(prefs, columnCount).scroll;
}

export function resolvePlayfieldFieldWidth(
  prefs: PreviewPrefs,
  ruleset: PreviewRuleset,
  columnCount?: number,
): number {
  if (ruleset === "mania") {
    return resolveManiaPlayfield(prefs, columnCount ?? 7).fieldWidth;
  }
  return prefs.playfield[ruleset].fieldWidth;
}

export function patchManiaPlayfield(
  prefs: PreviewPrefs,
  columnCount: number,
  patch: Partial<ManiaPlayfieldPrefs>,
): PreviewPrefs {
  const key = nearestKeymode(columnCount);
  const current = prefs.playfield.mania[key];
  return {
    ...prefs,
    playfield: {
      ...prefs.playfield,
      mania: {
        ...prefs.playfield.mania,
        [key]: {
          fieldWidth: clampFieldWidth(
            typeof patch.fieldWidth === "number"
              ? patch.fieldWidth
              : current.fieldWidth,
          ),
          scroll: migratePreviewScroll(
            typeof patch.scroll === "number" ? patch.scroll : current.scroll,
          ),
        },
      },
    },
  };
}

export function patchRulesetFieldWidth(
  prefs: PreviewPrefs,
  ruleset: Exclude<PreviewRuleset, "mania">,
  fieldWidth: number,
): PreviewPrefs {
  return {
    ...prefs,
    playfield: {
      ...prefs.playfield,
      [ruleset]: { fieldWidth: clampFieldWidth(fieldWidth) },
    },
  };
}

/** Patch Size for the active ruleset (and keymode when mania). */
export function patchPlayfieldFieldWidth(
  prefs: PreviewPrefs,
  ruleset: PreviewRuleset,
  fieldWidth: number,
  columnCount?: number,
): PreviewPrefs {
  if (ruleset === "mania") {
    return patchManiaPlayfield(prefs, columnCount ?? 7, { fieldWidth });
  }
  return patchRulesetFieldWidth(prefs, ruleset, fieldWidth);
}

export function loadPrefs(): PreviewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PreviewPrefs> & {
      scroll?: unknown;
      fieldWidth?: unknown;
      playfield?: unknown;
    };
    const legacyFieldWidth = parseFieldWidth(
      parsed.fieldWidth,
      FIELD_WIDTH_DEFAULT,
    );
    const legacyScroll = migratePreviewScroll(
      typeof parsed.scroll === "number"
        ? parsed.scroll
        : PREVIEW_SCROLL_DEFAULT,
    );
    return {
      volume: clamp(
        typeof parsed.volume === "number" ? parsed.volume : DEFAULT_PREFS.volume,
        0,
        1,
      ),
      rate:
        typeof parsed.rate === "number" && parsed.rate > 0
          ? clampRate(parsed.rate)
          : DEFAULT_PREFS.rate,
      fullscreen:
        typeof parsed.fullscreen === "boolean"
          ? parsed.fullscreen
          : DEFAULT_PREFS.fullscreen,
      playfield: parsePlayfield(
        parsed.playfield,
        legacyFieldWidth,
        legacyScroll,
      ),
      timingX: clamp(
        typeof parsed.timingX === "number"
          ? parsed.timingX
          : DEFAULT_PREFS.timingX,
        0,
        100,
      ),
      timingY: clamp(
        typeof parsed.timingY === "number"
          ? parsed.timingY
          : DEFAULT_PREFS.timingY,
        0,
        100,
      ),
      counterX: hudX(parsed.counterX, DEFAULT_PREFS.counterX),
      counterY: hudY(parsed.counterY, DEFAULT_PREFS.counterY),
      comboX: hudX(parsed.comboX, DEFAULT_PREFS.comboX),
      comboY: hudY(parsed.comboY, DEFAULT_PREFS.comboY),
      accuracyX: hudX(parsed.accuracyX, DEFAULT_PREFS.accuracyX),
      accuracyY: hudY(parsed.accuracyY, DEFAULT_PREFS.accuracyY),
      blackBg:
        typeof parsed.blackBg === "boolean"
          ? parsed.blackBg
          : DEFAULT_PREFS.blackBg,
      analysis:
        typeof parsed.analysis === "boolean"
          ? parsed.analysis
          : DEFAULT_PREFS.analysis,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
