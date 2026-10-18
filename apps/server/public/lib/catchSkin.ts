import { useSyncExternalStore } from "react";

export type ImportedCatchSkinMeta = {
  name: string;
  colours?: {
    comboColors?: string[];
    hyperDash?: string;
    hyperDashFruit?: string;
    hyperDashAfterImage?: string;
  };
};

export type CatchSkin = {
  comboColors: string[];
  droplet: string;
  banana: string;
  catcher: string;
  hyperDash: string;
  /** Outline tint for hyperdash fruits; defaults to hyperDash when unset. */
  hyperDashFruit: string;
  /** Afterimage / dash trail tint; defaults to hyperDash when unset. */
  hyperDashAfterImage: string;
  catcherScale: number;
  showHitPopups: boolean;
  showTrail: boolean;
  /** Metadata for an imported legacy `.osk` / skin.ini pack, if any. */
  imported: ImportedCatchSkinMeta | null;
};

export const DEFAULT_CATCH_COMBO_COLORS = [
  "#ff0000",
  "#ffc000",
  "#00ca00",
  "#00ffff",
  "#0080ff",
  "#ff00ff",
  "#ff80c0",
  "#ffffff",
];

export const CATCHER_SCALE_MIN = 0.6;
export const CATCHER_SCALE_MAX = 1.5;

export function defaultCatchSkin(): CatchSkin {
  return {
    comboColors: [...DEFAULT_CATCH_COMBO_COLORS],
    droplet: "#e4e4e7",
    banana: "#facc15",
    catcher: "#f4f4f5",
    hyperDash: "#fb7185",
    hyperDashFruit: "#fb7185",
    hyperDashAfterImage: "#fb7185",
    catcherScale: 0.7,
    showHitPopups: true,
    showTrail: true,
    imported: null,
  };
}

const STORAGE_KEY = "roxysu:catch-skin";
const EVENT = "roxysu:catch-skin";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Resolve palette colour by 0-based combo colour index. */
export function catchComboColorAtIndex(
  colors: string[] | undefined,
  colourIndex: number,
): string {
  const palette =
    colors && colors.length > 0 ? colors : DEFAULT_CATCH_COMBO_COLORS;
  const idx =
    ((colourIndex % palette.length) + palette.length) % palette.length;
  return palette[idx]!;
}

/** Resolve the combo color for a 1-based combo number (legacy). */
export function catchComboColorFor(skin: CatchSkin, combo: number): string {
  return catchComboColorAtIndex(skin.comboColors, Math.max(0, combo - 1));
}

/**
 * Effective combo palette.
 * When `preferSkin` (imported `.osk` active), skin colours win over beatmap
 * ComboN. Otherwise beatmap → skin → defaults.
 */
export function resolveCatchComboPalette(
  skinColors: string[] | undefined,
  beatmapColors: string[] | undefined,
  opts?: { preferSkin?: boolean },
): string[] {
  if (opts?.preferSkin && skinColors && skinColors.length > 0) {
    return skinColors;
  }
  if (beatmapColors && beatmapColors.length > 0) return beatmapColors;
  if (skinColors && skinColors.length > 0) return skinColors;
  return [...DEFAULT_CATCH_COMBO_COLORS];
}

function parseImported(value: unknown): ImportedCatchSkinMeta | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ImportedCatchSkinMeta>;
  if (typeof v.name !== "string" || !v.name.trim()) return null;
  return {
    name: v.name.trim(),
    colours: v.colours && typeof v.colours === "object" ? v.colours : undefined,
  };
}

function parseSkin(raw: string | null): CatchSkin {
  const defaults = defaultCatchSkin();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<CatchSkin>;
    const color = (v: unknown, fallback: string) => (isHex(v) ? v : fallback);
    const colors = Array.isArray(parsed.comboColors)
      ? parsed.comboColors.filter(isHex)
      : defaults.comboColors;
    const hyperDash = color(parsed.hyperDash, defaults.hyperDash);
    return {
      comboColors: colors.length > 0 ? colors : defaults.comboColors,
      droplet: color(parsed.droplet, defaults.droplet),
      banana: color(parsed.banana, defaults.banana),
      catcher: color(parsed.catcher, defaults.catcher),
      hyperDash,
      hyperDashFruit: color(parsed.hyperDashFruit, hyperDash),
      hyperDashAfterImage: color(parsed.hyperDashAfterImage, hyperDash),
      catcherScale: clamp(
        typeof parsed.catcherScale === "number"
          ? parsed.catcherScale
          : defaults.catcherScale,
        CATCHER_SCALE_MIN,
        CATCHER_SCALE_MAX,
      ),
      showHitPopups: parsed.showHitPopups !== false,
      showTrail: parsed.showTrail !== false,
      imported: parseImported(parsed.imported),
    };
  } catch {
    return defaults;
  }
}

let cachedSkin: CatchSkin | null = null;

function readSkinFromStorage(): CatchSkin {
  try {
    return parseSkin(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultCatchSkin();
  }
}

export function getCatchSkin(): CatchSkin {
  if (!cachedSkin) cachedSkin = readSkinFromStorage();
  return cachedSkin;
}

export function setCatchSkin(skin: CatchSkin): void {
  cachedSkin = skin;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skin));
  } catch {
    // ignore quota / private mode
  }
  window.dispatchEvent(new Event(EVENT));
}

export function resetCatchSkin(): void {
  setCatchSkin(defaultCatchSkin());
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

const serverSnapshot = defaultCatchSkin();

export function useCatchSkin(): CatchSkin {
  return useSyncExternalStore(subscribe, getCatchSkin, () => serverSnapshot);
}
