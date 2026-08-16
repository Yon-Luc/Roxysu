import { useSyncExternalStore } from "react";

export type CatchSkin = {
  comboColors: string[];
  droplet: string;
  banana: string;
  catcher: string;
  hyperDash: string;
  catcherScale: number;
  showHitPopups: boolean;
  showTrail: boolean;
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
    catcherScale: 0.7,
    showHitPopups: true,
    showTrail: true,
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

export function catchComboColorFor(skin: CatchSkin, combo: number): string {
  const colors =
    skin.comboColors.length > 0 ? skin.comboColors : DEFAULT_CATCH_COMBO_COLORS;
  return colors[(Math.max(0, combo - 1)) % colors.length]!;
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
    return {
      comboColors: colors.length > 0 ? colors : defaults.comboColors,
      droplet: color(parsed.droplet, defaults.droplet),
      banana: color(parsed.banana, defaults.banana),
      catcher: color(parsed.catcher, defaults.catcher),
      hyperDash: color(parsed.hyperDash, defaults.hyperDash),
      catcherScale: clamp(
        typeof parsed.catcherScale === "number"
          ? parsed.catcherScale
          : defaults.catcherScale,
        CATCHER_SCALE_MIN,
        CATCHER_SCALE_MAX,
      ),
      showHitPopups: parsed.showHitPopups !== false,
      showTrail: parsed.showTrail !== false,
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
