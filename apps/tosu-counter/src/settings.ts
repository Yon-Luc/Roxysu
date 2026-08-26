import {
  HIT_POSITION_MAX,
  HIT_POSITION_MIN,
  LANE_COVER_MAX,
  LANE_COVER_MIN,
} from "../../server/public/lib/previewSkin";
import { clamp } from "../../server/public/lib/clamp";
import {
  PREVIEW_SCROLL_MIN,
  PREVIEW_SCROLL_MAX,
  PREVIEW_SCROLL_DEFAULT,
} from "../../server/public/lib/paintManiaNotefield";

const STORAGE_KEY = "roxysu:tosu-counter-settings";

export const PLAYFIELD_SCALE_MIN = 20;
export const PLAYFIELD_SCALE_MAX = 100;
export const PLAYFIELD_SCALE_DEFAULT = 100;

export type CounterSettings = {
  scrollSpeed: number;
  hitPosition: number;
  laneCover: number;
  /** Transparent page background (for OBS browser source transparency). */
  transparentBg: boolean;
  /** "Roxysu" watermark stamp on the canvas. */
  showWatermark: boolean;
  /** Show the empty playfield preview while in song select (no map). */
  idlePreview: boolean;
  /** Hide the notefield while osu! is in the play state. */
  hideWhilePlaying: boolean;
  /** Notefield size as percent of the overlay (20–100). */
  playfieldScale: number;
};

export function coerceBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return null;
}

export function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function defaultCounterSettings(): CounterSettings {
  return {
    scrollSpeed: PREVIEW_SCROLL_DEFAULT,
    hitPosition: 0.88,
    laneCover: 0,
    transparentBg: false,
    showWatermark: true,
    idlePreview: true,
    hideWhilePlaying: false,
    playfieldScale: PLAYFIELD_SCALE_DEFAULT,
  };
}

function readStored(): Partial<CounterSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<CounterSettings>) : {};
  } catch {
    return {};
  }
}

/**
 * Settings resolve stored JSON → URL params (`scroll`, `hitpos`, `cover`,
 * `transparent`, `scale`, `hideplay`, `wm`). URL wins so OBS sources can pin a layout.
 */
export function loadCounterSettings(): CounterSettings {
  const base = { ...defaultCounterSettings(), ...readStored() };
  const params = new URLSearchParams(window.location.search);

  const num = (key: string): number | null => {
    const raw = params.get(key);
    if (raw == null || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const scroll = num("scroll");
  if (scroll != null) base.scrollSpeed = scroll;
  const hitpos = num("hitpos");
  if (hitpos != null) base.hitPosition = hitpos > 1 ? hitpos / 100 : hitpos;
  const cover = num("cover");
  if (cover != null) base.laneCover = cover > 1 ? cover / 100 : cover;

  base.scrollSpeed = clamp(
    base.scrollSpeed,
    PREVIEW_SCROLL_MIN,
    PREVIEW_SCROLL_MAX,
  );
  base.hitPosition = clamp(
    base.hitPosition,
    HIT_POSITION_MIN,
    HIT_POSITION_MAX,
  );
  base.laneCover = clamp(base.laneCover, LANE_COVER_MIN, LANE_COVER_MAX);

  const scale = num("scale");
  if (scale != null) base.playfieldScale = scale;
  base.playfieldScale = clamp(
    base.playfieldScale,
    PLAYFIELD_SCALE_MIN,
    PLAYFIELD_SCALE_MAX,
  );

  const transparent = params.get("transparent");
  if (transparent != null) base.transparentBg = transparent !== "0" && transparent !== "false";

  const wm = params.get("wm");
  if (wm != null) base.showWatermark = wm !== "0" && wm !== "false";

  const hideplay = params.get("hideplay");
  if (hideplay != null) {
    base.hideWhilePlaying = hideplay !== "0" && hideplay !== "false";
  }

  return base;
}

export function saveCounterSettings(settings: CounterSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota / private mode
  }
}
