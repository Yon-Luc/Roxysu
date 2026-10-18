import { unzipSync } from "fflate";
import { useSyncExternalStore } from "react";
import {
  decodeSkinIniBytes,
  parseSkinIni,
  type SkinIniColours,
} from "./osuSkinIni";
import { type StdPlayfieldSprites } from "./paintStdPlayfield";
import {
  defaultStdSkin,
  getStdSkin,
  setStdSkin,
  type ImportedStdSkinMeta,
  type StdSkin,
} from "./stdSkin";

export type StdSkinBlobs = Record<string, Blob>;

export type StdSkinImportDraft = {
  name: string;
  colours: SkinIniColours;
  sprites: StdPlayfieldSprites;
  blobs: StdSkinBlobs;
};

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif"] as const;
const SPRITE_EVENT = "roxysu:std-imported-skin";
const DB_NAME = "roxysu-std-skin";
const DB_VERSION = 1;
const STORE = "sprites";
const KEY_PREFIX = "std:";

type FileMap = Map<string, Uint8Array>;

let spriteCache: StdPlayfieldSprites | null = null;
let loadStarted = false;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripExt(path: string): string {
  return path.replace(/\.(png|jpe?g|gif)$/i, "");
}

export function unzipSkinArchive(data: Uint8Array): FileMap {
  const files = unzipSync(data);
  const map: FileMap = new Map();
  for (const [path, bytes] of Object.entries(files)) {
    if (!bytes || bytes.length === 0) continue;
    map.set(normalizePath(path), bytes);
  }
  return map;
}

export function findSkinIniPath(files: FileMap): string | null {
  const matches = [...files.keys()].filter((k) =>
    k.toLowerCase().endsWith("skin.ini"),
  );
  if (matches.length === 0) return null;
  matches.sort(
    (a, b) => a.split("/").length - b.split("/").length || a.length - b.length,
  );
  return matches[0] ?? null;
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function joinPath(root: string, name: string): string {
  const cleaned = normalizePath(name);
  if (!root) return cleaned;
  return `${root}/${cleaned}`;
}

function lookupImage(
  files: FileMap,
  root: string,
  name: string,
): Uint8Array | null {
  const raw = normalizePath(name).replace(/\\/g, "/");
  const noExt = stripExt(raw);
  const bases = [joinPath(root, noExt), noExt];
  const seen = new Set<string>();
  const tryKey = (key: string): Uint8Array | null => {
    const lower = key.toLowerCase();
    if (seen.has(lower)) return null;
    seen.add(lower);
    for (const [path, bytes] of files) {
      if (path.toLowerCase() === lower) return bytes;
    }
    return null;
  };

  for (const base of bases) {
    for (const ext of IMAGE_EXTS) {
      const hd = tryKey(`${base}@2x.${ext}`);
      if (hd) return hd;
    }
    for (const ext of IMAGE_EXTS) {
      const sd = tryKey(`${base}.${ext}`);
      if (sd) return sd;
    }
  }

  const needle = noExt.split("/").pop()?.toLowerCase();
  if (!needle) return null;
  for (const ext of IMAGE_EXTS) {
    for (const suffix of [`@2x.${ext}`, `.${ext}`]) {
      for (const [path, bytes] of files) {
        if (
          path.toLowerCase().endsWith(`/${needle}${suffix}`) ||
          path.toLowerCase() === `${needle}${suffix}`
        ) {
          return bytes;
        }
      }
    }
  }
  return null;
}

async function decodeImage(bytes: Uint8Array): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const copy = Uint8Array.from(bytes);
    const blob = new Blob([copy]);
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

function blobKey(kind: string, frame?: number): string {
  return frame == null
    ? `${KEY_PREFIX}${kind}`
    : `${KEY_PREFIX}${kind}:${frame}`;
}

async function resolveNamedImage(
  files: FileMap,
  root: string,
  names: string[],
  cache: Map<string, Promise<ImageBitmap | null>>,
  blobs: StdSkinBlobs,
  id: string,
): Promise<ImageBitmap | null> {
  for (const name of names) {
    const bytes = lookupImage(files, root, name);
    if (!bytes) continue;
    const cacheKey = `${name}:${bytes.length}`;
    let pending = cache.get(cacheKey);
    if (!pending) {
      pending = decodeImage(bytes);
      cache.set(cacheKey, pending);
    }
    const img = await pending;
    if (!img) continue;
    blobs[id] = new Blob([Uint8Array.from(bytes)]);
    return img;
  }
  return null;
}

/**
 * Candidate frame names for animated skin sprites.
 * Slider ball: stable uses `sliderb0`… then `sliderb`; hyphen / sliderball are fallbacks.
 */
export function animationFrameNameCandidates(
  kind: "sliderball" | "followpoint",
  frameIndex: number,
): string[] {
  if (kind === "sliderball") {
    return [
      `sliderb${frameIndex}`,
      `sliderb-${frameIndex}`,
      `sliderball${frameIndex}`,
      `sliderball-${frameIndex}`,
    ];
  }
  return [`followpoint-${frameIndex}`, `followpoint${frameIndex}`];
}

export function animationSingleNameCandidates(
  kind: "sliderball" | "followpoint",
): string[] {
  if (kind === "sliderball") {
    return ["sliderb", "sliderball"];
  }
  return ["followpoint"];
}

async function resolveAnimationFrames(
  files: FileMap,
  root: string,
  kind: "sliderball" | "followpoint",
  cache: Map<string, Promise<ImageBitmap | null>>,
  blobs: StdSkinBlobs,
): Promise<ImageBitmap[]> {
  const frames: ImageBitmap[] = [];
  for (let i = 0; i < 60; i += 1) {
    const img = await resolveNamedImage(
      files,
      root,
      animationFrameNameCandidates(kind, i),
      cache,
      blobs,
      blobKey(kind, i),
    );
    if (!img) break;
    frames.push(img);
  }
  if (frames.length === 0) {
    const single = await resolveNamedImage(
      files,
      root,
      animationSingleNameCandidates(kind),
      cache,
      blobs,
      blobKey(kind),
    );
    if (single) frames.push(single);
  }
  return frames;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

async function idbPut(entries: Array<[string, Blob]>): Promise<void> {
  if (typeof indexedDB === "undefined" || entries.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [key, blob] of entries) store.put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
  });
  db.close();
}

async function idbGetAll(): Promise<Array<[string, Blob]>> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  const rows = await new Promise<Array<[string, Blob]>>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).openCursor();
    const out: Array<[string, Blob]> = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      out.push([String(cursor.key), cursor.value as Blob]);
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error("indexedDB read failed"));
  });
  db.close();
  return rows;
}

async function idbClear(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB clear failed"));
  });
  db.close();
}

function emitSprites(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SPRITE_EVENT));
  }
}

function emptySprites(): StdPlayfieldSprites {
  return {
    defaults: Array.from({ length: 10 }, () => null),
    sliderballFrames: [],
    followpointFrames: [],
  };
}

async function buildDraftFromFiles(
  files: FileMap,
  fallbackName?: string,
): Promise<StdSkinImportDraft> {
  const iniPath = findSkinIniPath(files);
  if (!iniPath) throw new Error("No skin.ini found");
  const iniBytes = files.get(iniPath);
  if (!iniBytes) throw new Error("No skin.ini found");
  const parsed = parseSkinIni(decodeSkinIniBytes(iniBytes));
  const root = dirname(iniPath);
  const cache = new Map<string, Promise<ImageBitmap | null>>();
  const blobs: StdSkinBlobs = {};
  const sprites = emptySprites();

  const single = async (kind: keyof StdPlayfieldSprites, names: string[]) => {
    const img = await resolveNamedImage(
      files,
      root,
      names,
      cache,
      blobs,
      blobKey(String(kind)),
    );
    if (img) (sprites as Record<string, unknown>)[kind] = img;
  };

  await Promise.all([
    single("hitcircle", ["hitcircle"]),
    single("hitcircleoverlay", ["hitcircleoverlay"]),
    single("approachcircle", ["approachcircle"]),
    single("cursor", ["cursor"]),
    single("cursortrail", ["cursortrail"]),
    single("reversearrow", ["reversearrow"]),
    single("sliderfollowcircle", ["sliderfollowcircle"]),
    single("hit300", ["hit300"]),
    single("hit100", ["hit100"]),
    single("hit50", ["hit50"]),
    single("hit0", ["hit0"]),
  ]);

  const ballFrames = await resolveAnimationFrames(
    files,
    root,
    "sliderball",
    cache,
    blobs,
  );
  if (ballFrames.length > 0) {
    sprites.sliderballFrames = ballFrames;
    sprites.sliderball = ballFrames[0]!;
  }

  const followFrames = await resolveAnimationFrames(
    files,
    root,
    "followpoint",
    cache,
    blobs,
  );
  if (followFrames.length > 0) {
    sprites.followpointFrames = followFrames;
    sprites.followpoint = followFrames[0]!;
  }

  const defaults: Array<CanvasImageSource | null> = [];
  for (let d = 0; d <= 9; d += 1) {
    const img = await resolveNamedImage(
      files,
      root,
      [`default-${d}`, `default${d}`],
      cache,
      blobs,
      blobKey("default", d),
    );
    defaults.push(img);
  }
  sprites.defaults = defaults;

  return {
    name: parsed.name || fallbackName || "Imported skin",
    colours: parsed.colours,
    sprites,
    blobs,
  };
}

export async function draftFromArchiveBytes(
  data: Uint8Array | ArrayBuffer,
  fallbackName?: string,
): Promise<StdSkinImportDraft> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return buildDraftFromFiles(unzipSkinArchive(bytes), fallbackName);
}

export async function draftFromDroppedFiles(
  fileList: FileList | File[],
): Promise<StdSkinImportDraft> {
  const files = Array.from(fileList);
  const osk = files.find((f) => f.name.toLowerCase().endsWith(".osk"));
  if (osk) {
    const buf = new Uint8Array(await osk.arrayBuffer());
    return draftFromArchiveBytes(buf, osk.name.replace(/\.osk$/i, ""));
  }

  const map: FileMap = new Map();
  for (const file of files) {
    const path =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name;
    map.set(normalizePath(path), new Uint8Array(await file.arrayBuffer()));
  }
  if (![...map.keys()].some((k) => k.toLowerCase().endsWith("skin.ini"))) {
    throw new Error("Drop an .osk or a folder that contains skin.ini");
  }
  return buildDraftFromFiles(map);
}

function coloursToSkinPatch(colours: SkinIniColours): Partial<StdSkin> {
  const patch: Partial<StdSkin> = {};
  if (colours.comboColors.length > 0) patch.comboColors = colours.comboColors;
  if (colours.sliderBorder) patch.sliderTrack = colours.sliderBorder;
  // Only pin fill when skin.ini sets SliderTrackOverride; otherwise paint
  // uses combo colour at draw time.
  if (colours.sliderTrackOverride)
    patch.sliderFill = colours.sliderTrackOverride;
  if (colours.cursor) patch.cursor = colours.cursor;
  return patch;
}

export async function applyImportedStdSkin(
  draft: StdSkinImportDraft,
): Promise<void> {
  await idbClear();
  const entries = Object.entries(draft.blobs);
  await idbPut(entries);
  spriteCache = draft.sprites;
  const meta: ImportedStdSkinMeta = {
    name: draft.name,
    colours: {
      comboColors: draft.colours.comboColors,
      sliderBorder: draft.colours.sliderBorder,
      sliderTrackOverride: draft.colours.sliderTrackOverride,
      cursor: draft.colours.cursor,
    },
  };
  const current = getStdSkin();
  setStdSkin({
    ...current,
    ...coloursToSkinPatch(draft.colours),
    // True osu! CS scale for imported skins (editor can still lower it).
    hitCircleScale: 1,
    imported: meta,
  });
  emitSprites();
}

export async function resetImportedStdSkin(): Promise<void> {
  await idbClear();
  spriteCache = null;
  const defaults = defaultStdSkin();
  const current = getStdSkin();
  setStdSkin({
    ...defaults,
    hitCircleScale: current.hitCircleScale,
    showComboNumbers: current.showComboNumbers,
    showSliderTicks: current.showSliderTicks,
    showFollowCircle: current.showFollowCircle,
    showHitPopups: current.showHitPopups,
    imported: null,
  });
  emitSprites();
}

async function hydrateSpritesFromRows(
  rows: Array<[string, Blob]>,
): Promise<void> {
  const sprites = emptySprites();
  const assign = async (key: string, setter: (img: ImageBitmap) => void) => {
    const row = rows.find(([k]) => k === key);
    if (!row) return;
    try {
      setter(await createImageBitmap(row[1]));
    } catch {
      // skip
    }
  };

  await Promise.all([
    assign(blobKey("hitcircle"), (img) => {
      sprites.hitcircle = img;
    }),
    assign(blobKey("hitcircleoverlay"), (img) => {
      sprites.hitcircleoverlay = img;
    }),
    assign(blobKey("approachcircle"), (img) => {
      sprites.approachcircle = img;
    }),
    assign(blobKey("cursor"), (img) => {
      sprites.cursor = img;
    }),
    assign(blobKey("cursortrail"), (img) => {
      sprites.cursortrail = img;
    }),
    assign(blobKey("reversearrow"), (img) => {
      sprites.reversearrow = img;
    }),
    assign(blobKey("sliderfollowcircle"), (img) => {
      sprites.sliderfollowcircle = img;
    }),
    assign(blobKey("followpoint"), (img) => {
      sprites.followpoint = img;
    }),
    assign(blobKey("hit300"), (img) => {
      sprites.hit300 = img;
    }),
    assign(blobKey("hit100"), (img) => {
      sprites.hit100 = img;
    }),
    assign(blobKey("hit50"), (img) => {
      sprites.hit50 = img;
    }),
    assign(blobKey("hit0"), (img) => {
      sprites.hit0 = img;
    }),
  ]);

  const ballFrames: ImageBitmap[] = [];
  for (let i = 0; i < 60; i += 1) {
    const row = rows.find(([k]) => k === blobKey("sliderball", i));
    if (!row) break;
    try {
      ballFrames.push(await createImageBitmap(row[1]));
    } catch {
      break;
    }
  }
  if (ballFrames.length === 0) {
    await assign(blobKey("sliderball"), (img) => {
      sprites.sliderball = img;
      sprites.sliderballFrames = [img];
    });
  } else {
    sprites.sliderballFrames = ballFrames;
    sprites.sliderball = ballFrames[0]!;
  }

  const followFrames: ImageBitmap[] = [];
  for (let i = 0; i < 60; i += 1) {
    const row = rows.find(([k]) => k === blobKey("followpoint", i));
    if (!row) break;
    try {
      followFrames.push(await createImageBitmap(row[1]));
    } catch {
      break;
    }
  }
  if (followFrames.length === 0) {
    await assign(blobKey("followpoint"), (img) => {
      sprites.followpoint = img;
      sprites.followpointFrames = [img];
    });
  } else {
    sprites.followpointFrames = followFrames;
    sprites.followpoint = followFrames[0]!;
  }

  const defaults: Array<CanvasImageSource | null> = [];
  for (let d = 0; d <= 9; d += 1) {
    const row = rows.find(([k]) => k === blobKey("default", d));
    if (!row) {
      defaults.push(null);
      continue;
    }
    try {
      defaults.push(await createImageBitmap(row[1]));
    } catch {
      defaults.push(null);
    }
  }
  sprites.defaults = defaults;
  spriteCache = sprites;
  emitSprites();
}

async function hydrateFromIdb(): Promise<void> {
  await hydrateSpritesFromRows(await idbGetAll());
}

export function ensureImportedStdSpritesLoaded(): void {
  if (loadStarted || typeof indexedDB === "undefined") return;
  loadStarted = true;
  void hydrateFromIdb();
}

export function getImportedStdSprites(): StdPlayfieldSprites | null {
  return spriteCache;
}

export async function loadImportedStdSprites(): Promise<StdPlayfieldSprites | null> {
  if (!loadStarted) {
    ensureImportedStdSpritesLoaded();
    await hydrateFromIdb();
  } else if (!spriteCache) {
    await hydrateFromIdb();
  }
  return spriteCache;
}

export async function exportImportedStdSpriteDataUrls(): Promise<
  Record<string, string>
> {
  const rows = await idbGetAll();
  const out: Record<string, string> = {};
  for (const [key, blob] of rows) {
    out[key] = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  return out;
}

export async function countImportedStdSprites(): Promise<number> {
  try {
    return (await idbGetAll()).length;
  } catch {
    return 0;
  }
}

export async function applyOverlayStdSpriteEntries(
  blobKeys: string[],
): Promise<void> {
  const stdKeys = blobKeys.filter((k) => k.startsWith(KEY_PREFIX));
  if (stdKeys.length === 0) return;
  const rows: Array<[string, Blob]> = [];
  for (const key of stdKeys.slice(0, 256)) {
    try {
      const res = await fetch(
        `/api/overlay/skins/sprites/${encodeURIComponent(key)}`,
      );
      if (!res.ok) continue;
      rows.push([key, await res.blob()]);
    } catch {
      // skip
    }
  }
  if (rows.length === 0) return;
  loadStarted = true;
  await hydrateSpritesFromRows(rows);
}

function subscribeSprites(onStoreChange: () => void): () => void {
  ensureImportedStdSpritesLoaded();
  window.addEventListener(SPRITE_EVENT, onStoreChange);
  return () => window.removeEventListener(SPRITE_EVENT, onStoreChange);
}

export function useImportedStdSprites(): StdPlayfieldSprites | null {
  return useSyncExternalStore(
    subscribeSprites,
    getImportedStdSprites,
    () => null,
  );
}
