import { useSyncExternalStore } from "react";

/**
 * osu!standard playfield skin — visual-only. Mirrors `previewSkin.ts`
 * (separate store, `roxysu:std-skin`) but is a single global skin rather than
 * per-keymode.
 */

export type StdSkin = {
  /** Colors cycled per combo number (hit circles / slider heads). */
  comboColors: string[];
  /** Slider body outer track. */
  sliderTrack: string;
  /** Slider body inner fill. */
  sliderFill: string;
  /** Slider ball. */
  sliderBall: string;
  /** Spinner ring. */
  spinner: string;
  /** Approach ring stroke. */
  approach: string;
  /** Replay cursor fill. */
  cursor: string;
  /** Replay cursor trail stroke. */
  trail: string;
  /**
   * Visual scale applied to hit circles / slider bodies (0.5–1.5).
   * Default 0.9 renders slightly smaller than real osu! (1.0) so circles
   * read well on the tight playfield box; raise it to restore true proportions.
   */
  hitCircleScale: number;
  showComboNumbers: boolean;
  showSliderTicks: boolean;
  showFollowCircle: boolean;
  showHitPopups: boolean;
};

/** Classic stable default combo palette. */
export const DEFAULT_COMBO_COLORS = [
  "#ff0000",
  "#ffc000",
  "#00ca00",
  "#00ffff",
  "#0080ff",
  "#ff00ff",
  "#ff80c0",
  "#ffffff",
];

export function defaultStdSkin(): StdSkin {
  return {
    comboColors: [...DEFAULT_COMBO_COLORS],
    sliderTrack: "#a5b4fc",
    sliderFill: "#1c1c2e",
    sliderBall: "#fbbf24",
    spinner: "#fbbf24",
    approach: "#ffffff",
    cursor: "#ffffff",
    trail: "#ffffff",
    // Slightly smaller than real osu! (1.0) so circles read well on the
    // tighter playfield box; adjustable from the skin editor.
    hitCircleScale: 0.9,
    showComboNumbers: true,
    showSliderTicks: true,
    showFollowCircle: true,
    showHitPopups: true,
  };
}

const STORAGE_KEY = "roxysu:std-skin";
const EVENT = "roxysu:std-skin";

export const HIT_CIRCLE_SCALE_MIN = 0.5;
export const HIT_CIRCLE_SCALE_MAX = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Resolve the combo color for a 1-based combo number. */
export function comboColorFor(skin: StdSkin, combo: number): string {
  const colors = skin.comboColors.length > 0 ? skin.comboColors : DEFAULT_COMBO_COLORS;
  return colors[(Math.max(0, combo - 1)) % colors.length]!;
}

function parseSkin(raw: string | null): StdSkin {
  const defaults = defaultStdSkin();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<StdSkin>;
    const color = (v: unknown, fallback: string) => (isHex(v) ? v : fallback);
    const colors = Array.isArray(parsed.comboColors)
      ? parsed.comboColors.filter(isHex)
      : defaults.comboColors;
    return {
      comboColors: colors.length > 0 ? colors : defaults.comboColors,
      sliderTrack: color(parsed.sliderTrack, defaults.sliderTrack),
      sliderFill: color(parsed.sliderFill, defaults.sliderFill),
      sliderBall: color(parsed.sliderBall, defaults.sliderBall),
      spinner: color(parsed.spinner, defaults.spinner),
      approach: color(parsed.approach, defaults.approach),
      cursor: color(parsed.cursor, defaults.cursor),
      trail: color(parsed.trail, defaults.trail),
      hitCircleScale: clamp(
        typeof parsed.hitCircleScale === "number"
          ? parsed.hitCircleScale
          : defaults.hitCircleScale,
        HIT_CIRCLE_SCALE_MIN,
        HIT_CIRCLE_SCALE_MAX,
      ),
      showComboNumbers: parsed.showComboNumbers !== false,
      showSliderTicks: parsed.showSliderTicks !== false,
      showFollowCircle: parsed.showFollowCircle !== false,
      showHitPopups: parsed.showHitPopups !== false,
    };
  } catch {
    return defaults;
  }
}

let cachedSkin: StdSkin | null = null;

function readSkinFromStorage(): StdSkin {
  try {
    return parseSkin(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultStdSkin();
  }
}

export function getStdSkin(): StdSkin {
  if (!cachedSkin) cachedSkin = readSkinFromStorage();
  return cachedSkin;
}

export function setStdSkin(skin: StdSkin): void {
  cachedSkin = skin;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skin));
  } catch {
    // ignore quota / private mode
  }
  window.dispatchEvent(new Event(EVENT));
}

export function resetStdSkin(): void {
  setStdSkin(defaultStdSkin());
}

function subscribe(onStoreChange: () => void): () => void {
  function onChange() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) cachedSkin = parseSkin(raw);
    } catch {
      // keep cache
    }
    onStoreChange();
  }
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onStoreChange);
  };
}

const serverSnapshot = defaultStdSkin();

export function useStdSkin(): StdSkin {
  return useSyncExternalStore(subscribe, getStdSkin, () => serverSnapshot);
}