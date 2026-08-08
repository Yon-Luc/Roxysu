import {
  migratePreviewScroll,
  PREVIEW_SCROLL_DEFAULT,
} from "./ManiaNotefield";
import {
  TIMING_VIS_X_DEFAULT,
  TIMING_VIS_Y_DEFAULT,
} from "./TimingVisualizer";
import type { JudgmentSummary } from "../lib/maniaWindows";
import { clamp } from "../lib/format";

export const PREFS_KEY = "rx-beatmap-preview";
export const SKIP_MS = 5000;
export const PRESET_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
/** Fullscreen playfield width as % of the modal (saved). */
export const FIELD_WIDTH_MIN = 40;
export const FIELD_WIDTH_MAX = 100;
export const FIELD_WIDTH_DEFAULT = 55;

export type PreviewPrefs = {
  volume: number;
  rate: number;
  scroll: number;
  fullscreen: boolean;
  /** Fullscreen playfield max-width (% of dialog). */
  fieldWidth: number;
  /** Timing visualizer center X (% of playfield). */
  timingX: number;
  /** Timing visualizer center Y (% of playfield). */
  timingY: number;
  /** Solid black backdrop while in Play mode. */
  blackBg: boolean;
  /** Opt-in miss/timing/pattern tools. Default off. */
  analysis: boolean;
};

export const DEFAULT_PREFS: PreviewPrefs = {
  volume: 0.85,
  rate: 1,
  scroll: PREVIEW_SCROLL_DEFAULT,
  fullscreen: false,
  fieldWidth: FIELD_WIDTH_DEFAULT,
  timingX: TIMING_VIS_X_DEFAULT,
  timingY: TIMING_VIS_Y_DEFAULT,
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

export function loadPrefs(): PreviewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PreviewPrefs>;
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
      scroll: migratePreviewScroll(
        typeof parsed.scroll === "number" ? parsed.scroll : DEFAULT_PREFS.scroll,
      ),
      fullscreen:
        typeof parsed.fullscreen === "boolean"
          ? parsed.fullscreen
          : DEFAULT_PREFS.fullscreen,
      fieldWidth: clamp(
        typeof parsed.fieldWidth === "number"
          ? parsed.fieldWidth
          : DEFAULT_PREFS.fieldWidth,
        FIELD_WIDTH_MIN,
        FIELD_WIDTH_MAX,
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
