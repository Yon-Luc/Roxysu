import { useSyncExternalStore } from "react";

export type NoteShape = "flat" | "arrow" | "circle";

/** Arrow tip direction (down = toward receptor). Ignored for flat/circle. */
export type NoteOrientation = "down" | "left" | "up" | "right";

/** Cap at the far end of a long note (away from the receptor). */
export type LnTailShape = "flat" | "pointed" | "rounded";

export type Keymode = 4 | 6 | 7 | 8 | 9 | 10;

export const KEYMODES: Keymode[] = [4, 6, 7, 8, 9, 10];

export const NOTE_ORIENTATIONS: {
  id: NoteOrientation;
  label: string;
  /** Canvas clockwise degrees from the default down-pointing arrow. */
  deg: number;
}[] = [
  { id: "down", label: "↓", deg: 0 },
  { id: "left", label: "←", deg: 90 },
  { id: "up", label: "↑", deg: 180 },
  { id: "right", label: "→", deg: 270 },
];

export const LN_TAIL_SHAPES: { id: LnTailShape; label: string }[] = [
  { id: "flat", label: "Flat" },
  { id: "pointed", label: "Pointed" },
  { id: "rounded", label: "Rounded" },
];

export type ColumnSkin = {
  noteColor: string;
  lnColor: string;
  /** Relative column width fill (0.4–1). */
  widthScale: number;
  /** Relative tap/head height (0.5–2). */
  heightScale: number;
  /** Arrow tip direction. */
  orientation: NoteOrientation;
  /** Hold body width as a fraction of notehead width (0.25–1). */
  lnBodyScale: number;
};

export type KeymodeSkin = {
  shape: NoteShape;
  columns: ColumnSkin[];
  /** When true, note/LN colors from column 1 apply to all columns. */
  uniformColors: boolean;
  /** When true, widthScale from column 1 applies to all columns. */
  uniformWidth: boolean;
  /** When true, heightScale (size) from column 1 applies to all columns. */
  uniformSize: boolean;
  /** Shape of the LN end (away from receptor). */
  lnTailShape: LnTailShape;
  /** When false, hold notes omit the head note graphic. */
  lnShowHead: boolean;
};

/** Receptor Y as a fraction of playfield height (0 = top, 1 = bottom). */
export const HIT_POSITION_DEFAULT = 0.88;
export const HIT_POSITION_MIN = 0.55;
export const HIT_POSITION_MAX = 0.95;

/** Fraction of playfield height covered from the top with black. */
export const LANE_COVER_DEFAULT = 0;
export const LANE_COVER_MIN = 0;
export const LANE_COVER_MAX = 0.7;

export type PreviewSkin = {
  keymodes: Record<Keymode, KeymodeSkin>;
  /** Receptor / hit line position (fraction of height from top). */
  hitPosition: number;
  /** Top lane cover height (fraction of playfield height). */
  laneCover: number;
};

export const NOTE_SHAPES: { id: NoteShape; label: string }[] = [
  { id: "flat", label: "Flat" },
  { id: "arrow", label: "Arrow" },
  { id: "circle", label: "Circle" },
];

const STORAGE_KEY = "roxysu:preview-skin";
const EVENT = "roxysu:preview-skin";

const DEFAULT_NOTE_COLORS = [
  "#7dd3fc",
  "#fda4af",
  "#a5b4fc",
  "#fde68a",
  "#86efac",
  "#f9a8d4",
  "#c4b5fd",
  "#fdba74",
  "#67e8f9",
  "#fca5a5",
];

/** Classic dance-pad layout for 4K arrow skins: ← ↓ ↑ → */
const DANCE_PAD_4K: NoteOrientation[] = ["left", "down", "up", "right"];

function defaultOrientation(index: number, keys?: number): NoteOrientation {
  if (keys === 4) return DANCE_PAD_4K[index] ?? "down";
  return "down";
}

function defaultColumn(index: number, keys?: number): ColumnSkin {
  const noteColor = DEFAULT_NOTE_COLORS[index % DEFAULT_NOTE_COLORS.length]!;
  return {
    noteColor,
    lnColor: noteColor,
    widthScale: 0.92,
    heightScale: 1,
    orientation: defaultOrientation(index, keys),
    lnBodyScale: 0.6,
  };
}

export function defaultKeymodeSkin(keys: Keymode): KeymodeSkin {
  return {
    shape: "flat",
    columns: Array.from({ length: keys }, (_, i) => defaultColumn(i, keys)),
    uniformColors: false,
    uniformWidth: false,
    uniformSize: false,
    lnTailShape: "pointed",
    lnShowHead: true,
  };
}

export function orientationDegrees(orientation: NoteOrientation): number {
  return (
    NOTE_ORIENTATIONS.find((o) => o.id === orientation)?.deg ?? 0
  );
}

function parseOrientation(value: unknown): NoteOrientation {
  if (
    value === "down" ||
    value === "left" ||
    value === "up" ||
    value === "right"
  ) {
    return value;
  }
  return "down";
}

function parseLnTailShape(value: unknown): LnTailShape {
  if (value === "flat" || value === "pointed" || value === "rounded") {
    return value;
  }
  return "pointed";
}

export function defaultPreviewSkin(): PreviewSkin {
  return {
    keymodes: {
      4: defaultKeymodeSkin(4),
      6: defaultKeymodeSkin(6),
      7: defaultKeymodeSkin(7),
      8: defaultKeymodeSkin(8),
      9: defaultKeymodeSkin(9),
      10: defaultKeymodeSkin(10),
    },
    hitPosition: HIT_POSITION_DEFAULT,
    laneCover: LANE_COVER_DEFAULT,
  };
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseColumn(raw: unknown, index: number, keys?: number): ColumnSkin {
  const base = defaultColumn(index, keys);
  if (!raw || typeof raw !== "object") return base;
  const c = raw as Partial<ColumnSkin>;
  return {
    noteColor: isHexColor(c.noteColor) ? c.noteColor : base.noteColor,
    lnColor: isHexColor(c.lnColor) ? c.lnColor : base.lnColor,
    widthScale: clamp(
      typeof c.widthScale === "number" ? c.widthScale : base.widthScale,
      0.4,
      1,
    ),
    heightScale: clamp(
      typeof c.heightScale === "number" ? c.heightScale : base.heightScale,
      0.5,
      2,
    ),
    orientation: parseOrientation(c.orientation),
    lnBodyScale: clamp(
      typeof c.lnBodyScale === "number" ? c.lnBodyScale : base.lnBodyScale,
      0.25,
      1,
    ),
  };
}

function parseKeymodeSkin(raw: unknown, keys: Keymode): KeymodeSkin {
  const base = defaultKeymodeSkin(keys);
  if (!raw || typeof raw !== "object") return base;
  const k = raw as Partial<KeymodeSkin>;
  const shape: NoteShape =
    k.shape === "flat" || k.shape === "arrow" || k.shape === "circle"
      ? k.shape
      : "flat";
  const cols = Array.isArray(k.columns) ? k.columns : [];
  return {
    shape,
    columns: Array.from({ length: keys }, (_, i) =>
      parseColumn(cols[i], i, keys),
    ),
    uniformColors: k.uniformColors === true,
    uniformWidth: k.uniformWidth === true,
    uniformSize: k.uniformSize === true,
    lnTailShape: parseLnTailShape(k.lnTailShape),
    lnShowHead: k.lnShowHead !== false,
  };
}

function parseSkin(raw: string | null): PreviewSkin {
  const defaults = defaultPreviewSkin();
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as {
      keymodes?: Partial<Record<string, unknown>>;
      hitPosition?: unknown;
      laneCover?: unknown;
    };
    const keymodes = { ...defaults.keymodes };
    for (const keys of KEYMODES) {
      keymodes[keys] = parseKeymodeSkin(parsed.keymodes?.[String(keys)], keys);
    }
    return {
      keymodes,
      hitPosition: clamp(
        typeof parsed.hitPosition === "number"
          ? parsed.hitPosition
          : defaults.hitPosition,
        HIT_POSITION_MIN,
        HIT_POSITION_MAX,
      ),
      laneCover: clamp(
        typeof parsed.laneCover === "number"
          ? parsed.laneCover
          : defaults.laneCover,
        LANE_COVER_MIN,
        LANE_COVER_MAX,
      ),
    };
  } catch {
    return defaults;
  }
}

/** Cached snapshot — useSyncExternalStore requires a stable reference when unchanged. */
let cachedSkin: PreviewSkin | null = null;

function readSkinFromStorage(): PreviewSkin {
  try {
    return parseSkin(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultPreviewSkin();
  }
}

export function getPreviewSkin(): PreviewSkin {
  if (!cachedSkin) cachedSkin = readSkinFromStorage();
  return cachedSkin;
}

export function setPreviewSkin(skin: PreviewSkin): void {
  cachedSkin = skin;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(skin));
  } catch {
    // ignore quota / private mode
  }
  window.dispatchEvent(new Event(EVENT));
}

export function resetPreviewSkin(): void {
  setPreviewSkin(defaultPreviewSkin());
}

export function resetKeymodeSkin(keys: Keymode): void {
  const skin = getPreviewSkin();
  setPreviewSkin({
    ...skin,
    keymodes: {
      ...skin.keymodes,
      [keys]: defaultKeymodeSkin(keys),
    },
  });
}

/** Copy note/LN colors (and uniformColors) from one keymode onto another. Extra columns cycle the source palette. */
export function copyKeymodeColors(from: Keymode, to: Keymode): void {
  if (from === to) return;
  const skin = getPreviewSkin();
  const source = skin.keymodes[from];
  const target = skin.keymodes[to];
  const columns = target.columns.map((c, i) => {
    const src = source.uniformColors
      ? source.columns[0]!
      : source.columns[i % source.columns.length]!;
    return {
      ...c,
      noteColor: src.noteColor,
      lnColor: src.lnColor,
    };
  });
  setPreviewSkin({
    ...skin,
    keymodes: {
      ...skin.keymodes,
      [to]: {
        ...target,
        uniformColors: source.uniformColors,
        columns,
      },
    },
  });
}

function subscribe(onStoreChange: () => void): () => void {
  function onChange() {
    // Reload from storage on cross-tab updates; same-tab setPreviewSkin already updated cache.
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

const serverSnapshot = defaultPreviewSkin();

export function usePreviewSkin(): PreviewSkin {
  return useSyncExternalStore(subscribe, getPreviewSkin, () => serverSnapshot);
}

/** Resolve a keymode skin for an arbitrary column count (fallback to nearest / default). */
export function resolveKeymodeSkin(
  skin: PreviewSkin,
  columnCount: number,
): KeymodeSkin {
  if (KEYMODES.includes(columnCount as Keymode)) {
    return skin.keymodes[columnCount as Keymode];
  }
  // Nearest supported keymode by count, then pad/truncate columns.
  let nearest: Keymode = 7;
  let best = Infinity;
  for (const k of KEYMODES) {
    const d = Math.abs(k - columnCount);
    if (d < best) {
      best = d;
      nearest = k;
    }
  }
  const base = skin.keymodes[nearest];
  return {
    shape: base.shape,
    columns: Array.from({ length: Math.max(1, columnCount) }, (_, i) =>
      parseColumn(base.columns[i % base.columns.length], i, columnCount),
    ),
    uniformColors: base.uniformColors,
    uniformWidth: base.uniformWidth,
    uniformSize: base.uniformSize,
    lnTailShape: base.lnTailShape,
    lnShowHead: base.lnShowHead,
  };
}
