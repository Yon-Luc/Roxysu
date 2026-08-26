import type { ImportedManiaLayout } from "../../server/public/lib/previewSkin";
import { KEYMODES } from "../../server/public/lib/previewSkin";
import type { Keymode } from "../../server/public/lib/previewSkin";
import type { ManiaSkinSprites } from "../../server/public/lib/maniaSkinImport";

/**
 * Optional static skin pack served next to the counter:
 *   `./skin/skin-pack.json`
 *
 * ```json
 * {
 *   "name": "My skin",
 *   "layouts": { "4": { name, hitPositionPx, columnWidth[], columnSpacing[], columnLineWidth[] } },
 *   "sprites": { "4:notes:0": "data:image/png;base64,…", "4:stageLeft": "stage-left.png" }
 * }
 * ```
 *
 * Sprite values are fetched as-is, so both data URLs and plain paths
 * (resolved relative to `./skin/`) work. This exists because OBS browser
 * sources cannot open file pickers and have isolated IndexedDB — a pack file
 * exported from a real browser gives OBS the exact same imported skin.
 */

const PACK_URL = "./skin/skin-pack.json";

const SPRITE_KINDS = [
  "notes",
  "heads",
  "bodies",
  "tails",
  "keysUp",
  "keysDown",
] as const;
const STAGE_KINDS = ["stageLeft", "stageRight", "stageHint", "stageBottom"] as const;

export type SkinPackFile = {
  name?: unknown;
  layouts?: unknown;
  sprites?: unknown;
};

export type ValidatedSkinPack = {
  name: string;
  layouts: Partial<Record<Keymode, ImportedManiaLayout>>;
  sprites: Array<[string, string]>;
};

function validateLayout(raw: unknown): ImportedManiaLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Partial<ImportedManiaLayout>;
  if (typeof l.hitPositionPx !== "number" || !Number.isFinite(l.hitPositionPx)) {
    return null;
  }
  if (!Array.isArray(l.columnWidth) || l.columnWidth.length === 0) return null;
  const columnWidth = l.columnWidth.filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0,
  );
  if (columnWidth.length === 0) return null;
  return {
    name: typeof l.name === "string" && l.name ? l.name : "Folder skin",
    hitPositionPx: l.hitPositionPx,
    columnWidth,
    columnSpacing: Array.isArray(l.columnSpacing)
      ? l.columnSpacing.filter(
          (n): n is number => typeof n === "number" && Number.isFinite(n),
        )
      : [],
    columnLineWidth: Array.isArray(l.columnLineWidth)
      ? l.columnLineWidth.filter(
          (n): n is number => typeof n === "number" && Number.isFinite(n),
        )
      : [],
  };
}

/** Pure validation of a decoded pack file — unit-tested. */
export function validateSkinPack(raw: unknown): ValidatedSkinPack | null {
  if (!raw || typeof raw !== "object") return null;
  const pack = raw as SkinPackFile;
  if (!pack.sprites || typeof pack.sprites !== "object") return null;

  const sprites: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(pack.sprites)) {
    if (typeof value !== "string" || !value.trim()) continue;
    const parts = key.split(":");
    const keys = Number(parts[0]);
    if (!KEYMODES.includes(keys as Keymode)) continue;
    const kind = parts[1];
    if (SPRITE_KINDS.includes(kind as never)) {
      const col = Number(parts[2]);
      if (!Number.isInteger(col) || col < 0 || col >= keys) continue;
      sprites.push([key, value]);
      continue;
    }
    if (
      STAGE_KINDS.includes(kind as never) &&
      parts.length === 2
    ) {
      sprites.push([key, value]);
    }
  }
  if (sprites.length === 0) return null;

  const layouts: Partial<Record<Keymode, ImportedManiaLayout>> = {};
  if (pack.layouts && typeof pack.layouts === "object") {
    for (const [keysRaw, layoutRaw] of Object.entries(
      pack.layouts as Record<string, unknown>,
    )) {
      const keys = Number(keysRaw);
      if (!KEYMODES.includes(keys as Keymode)) continue;
      const layout = validateLayout(layoutRaw);
      if (layout) layouts[keys as Keymode] = layout;
    }
  }

  return {
    name:
      typeof pack.name === "string" && pack.name.trim()
        ? pack.name.trim()
        : "Folder skin",
    layouts,
    sprites,
  };
}

function emptySprites(keys: number): ManiaSkinSprites {
  const n = Math.max(1, keys);
  return {
    notes: Array.from({ length: n }, () => null),
    heads: Array.from({ length: n }, () => null),
    bodies: Array.from({ length: n }, () => null),
    tails: Array.from({ length: n }, () => null),
    keysUp: Array.from({ length: n }, () => null),
    keysDown: Array.from({ length: n }, () => null),
    stageLeft: null,
    stageRight: null,
    stageHint: null,
    stageBottom: null,
  };
}

let folderCache: Partial<Record<Keymode, ManiaSkinSprites>> = {};
let folderName: string | null = null;

export function getFolderSkinSprites(
  keys: number,
): ManiaSkinSprites | null {
  if (!KEYMODES.includes(keys as Keymode)) return null;
  return folderCache[keys as Keymode] ?? null;
}

export function getFolderSkinName(): string | null {
  return folderName;
}

async function fetchImage(
  src: string,
): Promise<ImageBitmap | HTMLImageElement | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (typeof createImageBitmap === "function") {
      return await createImageBitmap(blob);
    }
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(blob);
    });
  } catch {
    return null;
  }
}

async function applySkinPack(pack: ValidatedSkinPack): Promise<number> {
  const grouped: Partial<Record<Keymode, Record<string, string>>> = {};
  for (const [key, src] of pack.sprites) {
    const keys = Number(key.split(":")[0]) as Keymode;
    grouped[keys] ??= {};
    grouped[keys]![key] = src.startsWith("data:")
      ? src
      : new URL(src, new URL(PACK_URL, window.location.href)).href;
  }

  let loaded = 0;
  for (const keysStr of Object.keys(grouped)) {
    const keys = Number(keysStr) as Keymode;
    const sources = grouped[keys]!;
    const sprites = emptySprites(keys);
    const jobs: Promise<void>[] = [];

    const loadCol = async (
      kind: (typeof SPRITE_KINDS)[number],
      col: number,
      src: string,
    ) => {
      const img = await fetchImage(src);
      if (!img) return;
      loaded += 1;
      (sprites[kind][col] as unknown) = img;
    };
    const loadStage = async (
      kind: (typeof STAGE_KINDS)[number],
      src: string,
    ) => {
      const img = await fetchImage(src);
      if (!img) return;
      loaded += 1;
      (sprites[kind] as unknown) = img;
    };

    for (const [key, src] of Object.entries(sources)) {
      const [, kindRaw, colRaw] = key.split(":");
      if (SPRITE_KINDS.includes(kindRaw as never)) {
        jobs.push(
          loadCol(
            kindRaw as (typeof SPRITE_KINDS)[number],
            Number(colRaw),
            src,
          ),
        );
        continue;
      }
      if (STAGE_KINDS.includes(kindRaw as never)) {
        jobs.push(loadStage(kindRaw as (typeof STAGE_KINDS)[number], src));
      }
    }
    await Promise.all(jobs);
    folderCache[keys] = sprites;
  }
  return loaded;
}

export type LoadFolderSkinResult =
  | {
      ok: true;
      name: string;
      sprites: number;
      layouts: Partial<Record<Keymode, ImportedManiaLayout>>;
    }
  | { ok: false; reason: "missing" | "invalid" | "error"; message?: string };

/** Probe and load `./skin/skin-pack.json`. Missing file = ok:false/missing. */
export async function loadFolderSkin(): Promise<LoadFolderSkinResult> {
  folderCache = {};
  folderName = null;
  let raw: unknown;
  try {
    const res = await fetch(PACK_URL, { signal: AbortSignal.timeout(8_000) });
    if (res.status === 404) return { ok: false, reason: "missing" };
    if (!res.ok) return { ok: false, reason: "error", message: `HTTP ${res.status}` };
    raw = await res.json();
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const pack = validateSkinPack(raw);
  if (!pack) return { ok: false, reason: "invalid" };
  try {
    const sprites = await applySkinPack(pack);
    if (sprites === 0) return { ok: false, reason: "invalid" };
    folderName = pack.name;
    return { ok: true, name: pack.name, sprites, layouts: pack.layouts };
  } catch (err) {
    folderCache = {};
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
