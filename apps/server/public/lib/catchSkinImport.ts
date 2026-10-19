import { unzipSync } from "fflate";
import { useSyncExternalStore } from "react";
import { sanitizeZipEntryPath } from "../../src/shared/zipEntryPath";
import {
  decodeSkinIniBytes,
  parseSkinIni,
  type SkinIniCatchColours,
  type SkinIniColours,
} from "./osuSkinIni";
import type { CatchPlayfieldSprites } from "./paintCatchPlayfield";
import {
  defaultCatchSkin,
  getCatchSkin,
  setCatchSkin,
  type CatchSkin,
  type ImportedCatchSkinMeta,
} from "./catchSkin";

export type CatchSkinBlobs = Record<string, Blob>;

export type CatchSkinImportDraft = {
  name: string;
  colours: SkinIniColours;
  catchColours: SkinIniCatchColours;
  sprites: CatchPlayfieldSprites;
  blobs: CatchSkinBlobs;
};

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif"] as const;
const SPRITE_EVENT = "roxysu:catch-imported-skin";
const DB_NAME = "roxysu-catch-skin";
const DB_VERSION = 1;
const STORE = "sprites";
const KEY_PREFIX = "catch:";

type FileMap = Map<string, Uint8Array>;
type DecodedSkinImage = ImageBitmap | HTMLImageElement;

let spriteCache: CatchPlayfieldSprites | null = null;
let loadStarted = false;
let spriteEpoch = 0;

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
    const safe = sanitizeZipEntryPath(path);
    if (!safe) continue;
    map.set(safe, bytes);
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

async function decodeImage(bytes: Uint8Array): Promise<DecodedSkinImage | null> {
  const copy = Uint8Array.from(bytes);
  const blob = new Blob([copy]);
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      if (bmp.width > 0 && bmp.height > 0) return bmp;
      bmp.close?.();
    } catch {
      // fall through
    }
  }
  if (typeof Image === "undefined" || typeof URL === "undefined") return null;
  try {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
    (img as HTMLImageElement & { __blobUrl?: string }).__blobUrl = url;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) return img;
    URL.revokeObjectURL(url);
    return null;
  } catch {
    return null;
  }
}

function blobKey(kind: string): string {
  return `${KEY_PREFIX}${kind}`;
}

function emptySprites(): CatchPlayfieldSprites {
  return {};
}

async function resolveNamedImage(
  files: FileMap,
  root: string,
  names: string[],
  cache: Map<string, Promise<DecodedSkinImage | null>>,
  blobs: CatchSkinBlobs,
  id: string,
): Promise<DecodedSkinImage | null> {
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

/** Prefer static name, then animated frame 0. */
function catcherNameCandidates(base: string): string[] {
  return [base, `${base}-0`, `${base}0`];
}

async function buildDraftFromFiles(
  files: FileMap,
  fallbackName?: string,
): Promise<CatchSkinImportDraft> {
  const iniPath = findSkinIniPath(files);
  if (!iniPath) throw new Error("skin.ini not found in archive");
  const root = dirname(iniPath);
  const iniBytes = files.get(iniPath);
  if (!iniBytes) throw new Error("skin.ini unreadable");
  const parsed = parseSkinIni(decodeSkinIniBytes(iniBytes));
  const blobs: CatchSkinBlobs = {};
  const sprites = emptySprites();
  const cache = new Map<string, Promise<DecodedSkinImage | null>>();

  const scoop = async (
    names: string[],
    key: string,
    setter: (img: DecodedSkinImage) => void,
  ) => {
    const img = await resolveNamedImage(
      files,
      root,
      names,
      cache,
      blobs,
      blobKey(key),
    );
    if (img) setter(img);
  };

  await Promise.all([
    scoop(["fruit-pear"], "pear", (img) => {
      sprites.pear = img;
    }),
    scoop(["fruit-pear-overlay"], "pearOverlay", (img) => {
      sprites.pearOverlay = img;
    }),
    scoop(["fruit-grapes"], "grapes", (img) => {
      sprites.grapes = img;
    }),
    scoop(["fruit-grapes-overlay"], "grapesOverlay", (img) => {
      sprites.grapesOverlay = img;
    }),
    scoop(["fruit-apple"], "apple", (img) => {
      sprites.apple = img;
    }),
    scoop(["fruit-apple-overlay"], "appleOverlay", (img) => {
      sprites.appleOverlay = img;
    }),
    scoop(["fruit-orange"], "orange", (img) => {
      sprites.orange = img;
    }),
    scoop(["fruit-orange-overlay"], "orangeOverlay", (img) => {
      sprites.orangeOverlay = img;
    }),
    scoop(["fruit-drop"], "drop", (img) => {
      sprites.drop = img;
    }),
    scoop(["fruit-drop-overlay"], "dropOverlay", (img) => {
      sprites.dropOverlay = img;
    }),
    scoop(["fruit-bananas"], "bananas", (img) => {
      sprites.bananas = img;
    }),
    scoop(["fruit-bananas-overlay"], "bananasOverlay", (img) => {
      sprites.bananasOverlay = img;
    }),
    scoop(catcherNameCandidates("fruit-catcher-idle"), "catcherIdle", (img) => {
      sprites.catcherIdle = img;
    }),
    scoop(catcherNameCandidates("fruit-catcher-fail"), "catcherFail", (img) => {
      sprites.catcherFail = img;
    }),
    scoop(catcherNameCandidates("fruit-catcher-kiai"), "catcherKiai", (img) => {
      sprites.catcherKiai = img;
    }),
    scoop(["lighting"], "lighting", (img) => {
      sprites.lighting = img;
    }),
  ]);

  // Legacy catcher fallback
  if (!sprites.catcherIdle) {
    await scoop(catcherNameCandidates("fruit-ryuuta"), "catcherIdle", (img) => {
      sprites.catcherIdle = img;
    });
  }

  return {
    name: parsed.name || fallbackName || "Imported catch skin",
    colours: parsed.colours,
    catchColours: parsed.catchColours,
    sprites,
    blobs,
  };
}

export async function draftFromArchiveBytes(
  data: Uint8Array | ArrayBuffer,
  fallbackName?: string,
): Promise<CatchSkinImportDraft> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return buildDraftFromFiles(unzipSkinArchive(bytes), fallbackName);
}

export async function draftFromDroppedFiles(
  fileList: FileList | File[],
): Promise<CatchSkinImportDraft> {
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
  });
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB clear failed"));
  });
  db.close();
}

async function idbPut(entries: Array<[string, Blob]>): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const [key, blob] of entries) store.put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB put failed"));
  });
  db.close();
}

async function idbGetAll(): Promise<Array<[string, Blob]>> {
  const db = await openDb();
  const rows = await new Promise<Array<[string, Blob]>>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
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
    req.onerror = () => reject(req.error ?? new Error("IDB cursor failed"));
  });
  db.close();
  return rows;
}

function emitSprites(): void {
  window.dispatchEvent(new Event(SPRITE_EVENT));
}

function coloursToSkinPatch(
  colours: SkinIniColours,
  catchColours: SkinIniCatchColours,
): Partial<CatchSkin> {
  const patch: Partial<CatchSkin> = {};
  if (colours.comboColors.length > 0) patch.comboColors = colours.comboColors;
  if (catchColours.hyperDash) {
    patch.hyperDash = catchColours.hyperDash;
    patch.hyperDashFruit =
      catchColours.hyperDashFruit ?? catchColours.hyperDash;
    patch.hyperDashAfterImage =
      catchColours.hyperDashAfterImage ?? catchColours.hyperDash;
  } else {
    if (catchColours.hyperDashFruit)
      patch.hyperDashFruit = catchColours.hyperDashFruit;
    if (catchColours.hyperDashAfterImage)
      patch.hyperDashAfterImage = catchColours.hyperDashAfterImage;
  }
  return patch;
}

export async function applyImportedCatchSkin(
  draft: CatchSkinImportDraft,
): Promise<void> {
  spriteEpoch += 1;
  const epoch = spriteEpoch;
  await idbClear();
  await idbPut(Object.entries(draft.blobs));
  if (epoch !== spriteEpoch) return;
  spriteCache = draft.sprites;
  const meta: ImportedCatchSkinMeta = {
    name: draft.name,
    colours: {
      comboColors: draft.colours.comboColors,
      hyperDash: draft.catchColours.hyperDash,
      hyperDashFruit: draft.catchColours.hyperDashFruit,
      hyperDashAfterImage: draft.catchColours.hyperDashAfterImage,
    },
  };
  const current = getCatchSkin();
  setCatchSkin({
    ...current,
    ...coloursToSkinPatch(draft.colours, draft.catchColours),
    imported: meta,
  });
  emitSprites();
}

export async function resetImportedCatchSkin(): Promise<void> {
  spriteEpoch += 1;
  await idbClear();
  spriteCache = null;
  const defaults = defaultCatchSkin();
  const current = getCatchSkin();
  setCatchSkin({
    ...defaults,
    catcherScale: current.catcherScale,
    showHitPopups: current.showHitPopups,
    showTrail: current.showTrail,
    imported: null,
  });
  emitSprites();
}

async function decodeBlob(blob: Blob): Promise<DecodedSkinImage | null> {
  return decodeImage(new Uint8Array(await blob.arrayBuffer()));
}

async function hydrateSpritesFromRows(
  rows: Array<[string, Blob]>,
  epoch: number,
): Promise<void> {
  const sprites = emptySprites();
  const assign = async (
    key: string,
    setter: (img: DecodedSkinImage) => void,
  ) => {
    const row = rows.find(([k]) => k === key);
    if (!row) return;
    try {
      const img = await decodeBlob(row[1]);
      if (img) setter(img);
    } catch {
      // skip
    }
  };

  await Promise.all([
    assign(blobKey("pear"), (img) => {
      sprites.pear = img;
    }),
    assign(blobKey("pearOverlay"), (img) => {
      sprites.pearOverlay = img;
    }),
    assign(blobKey("grapes"), (img) => {
      sprites.grapes = img;
    }),
    assign(blobKey("grapesOverlay"), (img) => {
      sprites.grapesOverlay = img;
    }),
    assign(blobKey("apple"), (img) => {
      sprites.apple = img;
    }),
    assign(blobKey("appleOverlay"), (img) => {
      sprites.appleOverlay = img;
    }),
    assign(blobKey("orange"), (img) => {
      sprites.orange = img;
    }),
    assign(blobKey("orangeOverlay"), (img) => {
      sprites.orangeOverlay = img;
    }),
    assign(blobKey("drop"), (img) => {
      sprites.drop = img;
    }),
    assign(blobKey("dropOverlay"), (img) => {
      sprites.dropOverlay = img;
    }),
    assign(blobKey("bananas"), (img) => {
      sprites.bananas = img;
    }),
    assign(blobKey("bananasOverlay"), (img) => {
      sprites.bananasOverlay = img;
    }),
    assign(blobKey("catcherIdle"), (img) => {
      sprites.catcherIdle = img;
    }),
    assign(blobKey("catcherFail"), (img) => {
      sprites.catcherFail = img;
    }),
    assign(blobKey("catcherKiai"), (img) => {
      sprites.catcherKiai = img;
    }),
    assign(blobKey("lighting"), (img) => {
      sprites.lighting = img;
    }),
  ]);
  if (epoch !== spriteEpoch) return;
  spriteCache = sprites;
  emitSprites();
}

export function ensureImportedCatchSpritesLoaded(): void {
  if (loadStarted || typeof indexedDB === "undefined") return;
  loadStarted = true;
  const epoch = spriteEpoch;
  void idbGetAll()
    .then((rows) => hydrateSpritesFromRows(rows, epoch))
    .catch(() => {
      loadStarted = false;
    });
}

export function getImportedCatchSprites(): CatchPlayfieldSprites | null {
  return spriteCache;
}

export async function loadImportedCatchSprites(): Promise<CatchPlayfieldSprites | null> {
  ensureImportedCatchSpritesLoaded();
  if (spriteCache) return spriteCache;
  const epoch = spriteEpoch;
  const rows = await idbGetAll();
  await hydrateSpritesFromRows(rows, epoch);
  return spriteCache;
}

export async function exportImportedCatchSpriteDataUrls(): Promise<
  Record<string, string>
> {
  const rows = await idbGetAll();
  const out: Record<string, string> = {};
  await Promise.all(
    rows.map(async ([key, blob]) => {
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]!);
      }
      const mime = blob.type || "image/png";
      out[key] = `data:${mime};base64,${btoa(binary)}`;
    }),
  );
  return out;
}

export async function applyOverlayCatchSpriteEntries(
  keys: string[],
): Promise<void> {
  const catchKeys = keys.filter((k) => k.startsWith(KEY_PREFIX));
  if (catchKeys.length === 0) {
    spriteCache = null;
    emitSprites();
    return;
  }
  // Overlay consumers receive data URLs via snapshot.sprites — hydrate from
  // the global snapshot applied by overlaySkins (keys already in IndexedDB
  // when published from the same origin). Reload from IDB.
  ensureImportedCatchSpritesLoaded();
  loadStarted = false;
  ensureImportedCatchSpritesLoaded();
}

/**
 * Apply overlay sprite data-URL entries prefixed with `catch:` into the
 * in-memory sprite cache (and IndexedDB when available).
 */
export async function applyOverlayCatchSpriteDataUrls(
  sprites: Record<string, string>,
): Promise<void> {
  const entries: Array<[string, Blob]> = [];
  for (const [key, dataUrl] of Object.entries(sprites)) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const comma = dataUrl.indexOf(",");
    if (comma < 0) continue;
    const meta = dataUrl.slice(0, comma);
    const b64 = dataUrl.slice(comma + 1);
    const mimeMatch = /^data:([^;]+)/.exec(meta);
    const mime = mimeMatch?.[1] ?? "image/png";
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      entries.push([key, new Blob([bytes], { type: mime })]);
    } catch {
      // skip bad entry
    }
  }
  if (entries.length === 0) return;
  spriteEpoch += 1;
  const epoch = spriteEpoch;
  try {
    await idbClear();
    await idbPut(entries);
  } catch {
    // memory-only fallback
  }
  await hydrateSpritesFromRows(entries, epoch);
}

export async function countImportedCatchSprites(): Promise<number> {
  try {
    const rows = await idbGetAll();
    return rows.length;
  } catch {
    return 0;
  }
}

function subscribeSprites(onStoreChange: () => void): () => void {
  ensureImportedCatchSpritesLoaded();
  window.addEventListener(SPRITE_EVENT, onStoreChange);
  return () => window.removeEventListener(SPRITE_EVENT, onStoreChange);
}

export function useImportedCatchSprites(): CatchPlayfieldSprites | null {
  return useSyncExternalStore(
    subscribeSprites,
    getImportedCatchSprites,
    () => null,
  );
}
