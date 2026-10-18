import { useSyncExternalStore } from "react";

/**
 * osu!standard playfield skin — visual-only. Mirrors `previewSkin.ts`
 * (separate store, `roxysu:std-skin`) but is a single global skin rather than
 * per-keymode.
 */

export type ImportedStdSkinMeta = {
  name: string;
  colours?: {
    comboColors?: string[];
    sliderBorder?: string;
    sliderTrackOverride?: string;
    cursor?: string;
  };
};

export type StdSkin = {
  /** Colors cycled per combo colour index (hit circles / slider heads). */
  comboColors: string[];
  /** Slider body outer track. */
  sliderTrack: string;
  /** Slider body inner fill. */
  sliderFill: string;
  /** Slider ball. */
  sliderBall: string;
  /** Spinner ring. */
  spinner: string;
  /** Approach ring stroke (custom override; default white → tint with combo). */
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
  /** Metadata for an imported legacy `.osk` / skin.ini pack, if any. */
  imported: ImportedStdSkinMeta | null;
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
    imported: null,
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

/** Resolve the combo color for a 1-based combo number (legacy). */
export function comboColorFor(skin: StdSkin, combo: number): string {
  return comboColorAtIndex(skin.comboColors, Math.max(0, combo - 1));
}

/** Resolve palette colour by 0-based combo colour index. */
export function comboColorAtIndex(
  colors: string[] | undefined,
  colourIndex: number,
): string {
  const palette =
    colors && colors.length > 0 ? colors : DEFAULT_COMBO_COLORS;
  const idx =
    ((colourIndex % palette.length) + palette.length) % palette.length;
  return palette[idx]!;
}

/**
 * Effective combo palette: beatmap `[Colours]` wins, then skin, then defaults.
 */
export function resolveComboPalette(
  skinColors: string[] | undefined,
  beatmapColors: string[] | undefined,
): string[] {
  if (beatmapColors && beatmapColors.length > 0) return beatmapColors;
  if (skinColors && skinColors.length > 0) return skinColors;
  return [...DEFAULT_COMBO_COLORS];
}

function parseImported(
  value: unknown,
): ImportedStdSkinMeta | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ImportedStdSkinMeta>;
  if (typeof v.name !== "string" || !v.name.trim()) return null;
  return {
    name: v.name.trim(),
    colours: v.colours && typeof v.colours === "object" ? v.colours : undefined,
  };
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
      imported: parseImported(parsed.imported),
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
