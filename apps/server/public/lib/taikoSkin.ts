import { useSyncExternalStore } from "react";

export type TaikoSkin = {
  don: string;
  kat: string;
  donLarge: string;
  katLarge: string;
  drumroll: string;
  swell: string;
  receptor: string;
  hitLine: string;
  playfield: string;
  noteScale: number;
  scrollSpeed: number;
  showHitPopups: boolean;
  showBarlines: boolean;
};

export const TAIKO_NOTE_SCALE_MIN = 0.5;
export const TAIKO_NOTE_SCALE_MAX = 1.5;
export const TAIKO_SCROLL_MIN = 400;
export const TAIKO_SCROLL_MAX = 2400;

export function defaultTaikoSkin(): TaikoSkin {
  return {
    don: "#ef4444",
    kat: "#38bdf8",
    donLarge: "#f97316",
    katLarge: "#818cf8",
    drumroll: "#fbbf24",
    swell: "#f472b6",
    receptor: "#ffffff",
    hitLine: "#ffffff",
    playfield: "#14141c",
    noteScale: 1,
    scrollSpeed: 900,
    showHitPopups: true,
    showBarlines: true,
  };
}

const STORAGE_KEY = "roxysu:taiko-skin";
const EVENT = "roxysu:taiko-skin";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function parseSkin(raw: string | null): TaikoSkin {
  const defaults = defaultTaikoSkin();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<TaikoSkin>;
    const color = (v: unknown, fallback: string) => (isHex(v) ? v : fallback);
    return {
      don: color(parsed.don, defaults.don),
      kat: color(parsed.kat, defaults.kat),
      donLarge: color(parsed.donLarge, defaults.donLarge),
      katLarge: color(parsed.katLarge, defaults.katLarge),
      drumroll: color(parsed.drumroll, defaults.drumroll),
      swell: color(parsed.swell, defaults.swell),
      receptor: color(parsed.receptor, defaults.receptor),
      hitLine: color(parsed.hitLine, defaults.hitLine),
      playfield: color(parsed.playfield, defaults.playfield),
      noteScale: clamp(
        typeof parsed.noteScale === "number" ? parsed.noteScale : defaults.noteScale,
        TAIKO_NOTE_SCALE_MIN,
        TAIKO_NOTE_SCALE_MAX,
      ),
      scrollSpeed: clamp(
        typeof parsed.scrollSpeed === "number"
          ? parsed.scrollSpeed
          : defaults.scrollSpeed,
        TAIKO_SCROLL_MIN,
        TAIKO_SCROLL_MAX,
      ),
      showHitPopups: parsed.showHitPopups !== false,
      showBarlines: parsed.showBarlines !== false,
    };
  } catch {
    return defaults;
  }
}

let cachedSkin: TaikoSkin | null = null;

function readSkinFromStorage(): TaikoSkin {
  try {
    return parseSkin(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultTaikoSkin();
  }
}

export function getTaikoSkin(): TaikoSkin {
  if (!cachedSkin) cachedSkin = readSkinFromStorage();
  return cachedSkin;
}

export function setTaikoSkin(skin: TaikoSkin): void {
  cachedSkin = skin;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skin));
  } catch {
    // ignore quota / private mode
  }
  window.dispatchEvent(new Event(EVENT));
}

export function resetTaikoSkin(): void {
  setTaikoSkin(defaultTaikoSkin());
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

const serverSnapshot = defaultTaikoSkin();

export function useTaikoSkin(): TaikoSkin {
  return useSyncExternalStore(subscribe, getTaikoSkin, () => serverSnapshot);
}
