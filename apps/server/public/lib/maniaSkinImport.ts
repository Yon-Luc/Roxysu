import { unzipSync } from "fflate";
import { useEffect, useSyncExternalStore } from "react";
import {
  decodeSkinIniBytes,
  importedHitPositionFrac,
  keyImageCandidates,
  noteImageCandidates,
  parseSkinIni,
  resolveManiaSection,
  stageImageCandidates,
  type SkinIniManiaSection,
} from "./osuSkinIni";
import {
  KEYMODES,
  defaultKeymodeSkin,
  getPreviewSkin,
  resetPreviewSkin,
  setPreviewSkin,
  type ImportedManiaLayout,
  type Keymode,
} from "./previewSkin";

export type SkinImage = CanvasImageSource;

export type ManiaSkinSprites = {
  notes: (SkinImage | null)[];
  heads: (SkinImage | null)[];
  bodies: (SkinImage | null)[];
  tails: (SkinImage | null)[];
  keysUp: (SkinImage | null)[];
  keysDown: (SkinImage | null)[];
  stageLeft: SkinImage | null;
  stageRight: SkinImage | null;
  stageHint: SkinImage | null;
  stageBottom: SkinImage | null;
};

export type ManiaSkinBlobs = Record<string, Blob>;

export type ManiaSkinPack = {
  layout: ImportedManiaLayout;
  sprites: ManiaSkinSprites;
  blobs: ManiaSkinBlobs;
};

export type ManiaSkinImportDraft = {
  name: string;
  definedKeys: number[];
  packs: Partial<Record<Keymode, ManiaSkinPack>>;
};

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif"] as const;
const SPRITE_EVENT = "roxysu:mania-imported-skin";
const DB_NAME = "roxysu-mania-skin";
const DB_VERSION = 1;
const STORE = "sprites";

type FileMap = Map<string, Uint8Array>;

let spriteCache: Partial<Record<Keymode, ManiaSkinSprites>> = {};
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

function lookupImage(files: FileMap, root: string, name: string): Uint8Array | null {
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
        if (path.toLowerCase().endsWith(`/${needle}${suffix}`) ||
          path.toLowerCase() === `${needle}${suffix}`) {
          return bytes;
        }
      }
    }
  }
  return null;
}

function blobKey(
  keys: Keymode,
  kind: string,
  col?: number,
): string {
  return col == null ? `${keys}:${kind}` : `${keys}:${kind}:${col}`;
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

async function resolveNamedImage(
  files: FileMap,
  root: string,
  names: string[],
  cache: Map<string, Promise<ImageBitmap | null>>,
  blobs: ManiaSkinBlobs,
  blobId: string,
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
    const copy = Uint8Array.from(bytes);
    blobs[blobId] = new Blob([copy]);
    return img;
  }
  return null;
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

async function idbDeletePrefix(prefix: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"));
  });
  db.close();
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

function layoutFromSection(
  name: string,
  section: SkinIniManiaSection,
): ImportedManiaLayout {
  return {
    name,
    hitPositionPx: section.hitPosition,
    columnWidth: section.columnWidth,
    columnSpacing: section.columnSpacing,
    columnLineWidth: section.columnLineWidth,
  };
}

async function buildPack(
  name: string,
  section: SkinIniManiaSection,
  files: FileMap,
  root: string,
  decodeCache: Map<string, Promise<ImageBitmap | null>>,
): Promise<ManiaSkinPack> {
  const keys = section.keys as Keymode;
  const sprites = emptySprites(section.keys);
  const blobs: ManiaSkinBlobs = {};

  const loadCol = async (
    kind: "notes" | "heads" | "bodies" | "tails" | "keysUp" | "keysDown",
    col: number,
    names: string[],
  ) => {
    const img = await resolveNamedImage(
      files,
      root,
      names,
      decodeCache,
      blobs,
      blobKey(keys, kind, col),
    );
    sprites[kind][col] = img;
  };

  const jobs: Promise<unknown>[] = [];
  for (let c = 0; c < section.keys; c += 1) {
    jobs.push(loadCol("notes", c, noteImageCandidates(section, c, "")));
    jobs.push(loadCol("heads", c, noteImageCandidates(section, c, "H")));
    jobs.push(loadCol("bodies", c, noteImageCandidates(section, c, "L")));
    jobs.push(loadCol("tails", c, noteImageCandidates(section, c, "T")));
    jobs.push(loadCol("keysUp", c, keyImageCandidates(section, c, false)));
    jobs.push(loadCol("keysDown", c, keyImageCandidates(section, c, true)));
  }

  const loadStage = async (
    role: "stageLeft" | "stageRight" | "stageHint" | "stageBottom",
    names: string[],
  ) => {
    sprites[role] = await resolveNamedImage(
      files,
      root,
      names,
      decodeCache,
      blobs,
      blobKey(keys, role),
    );
  };

  jobs.push(loadStage("stageLeft", stageImageCandidates(section, "left")));
  jobs.push(loadStage("stageRight", stageImageCandidates(section, "right")));
  jobs.push(loadStage("stageHint", stageImageCandidates(section, "hint")));
  jobs.push(loadStage("stageBottom", stageImageCandidates(section, "bottom")));
  await Promise.all(jobs);

  return {
    layout: layoutFromSection(name, section),
    sprites,
    blobs,
  };
}

export async function buildManiaSkinDraft(
  files: FileMap,
  fallbackName = "Imported skin",
): Promise<ManiaSkinImportDraft> {
  const iniPath = findSkinIniPath(files);
  if (!iniPath) throw new Error("No skin.ini found");
  const iniBytes = files.get(iniPath);
  if (!iniBytes) throw new Error("No skin.ini found");
  const parsed = parseSkinIni(decodeSkinIniBytes(iniBytes));
  const name = parsed.name || fallbackName;
  const root = dirname(iniPath);
  const decodeCache = new Map<string, Promise<ImageBitmap | null>>();
  const packs: Partial<Record<Keymode, ManiaSkinPack>> = {};
  for (const keys of KEYMODES) {
    const section = resolveManiaSection(parsed.mania, keys);
    packs[keys] = await buildPack(name, section, files, root, decodeCache);
  }
  return {
    name,
    definedKeys: parsed.mania.map((s) => s.keys),
    packs,
  };
}

type DroppedFile = { path: string; file: File };

async function walkEntry(
  entry: FileSystemEntry,
  out: DroppedFile[],
  prefix = "",
): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    out.push({ path, file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  let chunk = await readBatch();
  while (chunk.length > 0) {
    for (const child of chunk) await walkEntry(child, out, path);
    chunk = await readBatch();
  }
}

async function collectDroppedFiles(dt: DataTransfer): Promise<DroppedFile[]> {
  const items = dt.items;
  if (items && items.length > 0 && items[0] && "webkitGetAsEntry" in items[0]) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const entry = items[i]!.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      const out: DroppedFile[] = [];
      for (const entry of entries) await walkEntry(entry, out);
      if (out.length > 0) return out;
    }
  }
  return [...dt.files].map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    return { path: rel && rel.length > 0 ? rel : file.name, file };
  });
}

async function filesToMap(files: DroppedFile[]): Promise<FileMap> {
  const osk = files.find((f) =>
    /\.(osk|zip)$/i.test(f.path || f.file.name),
  );
  const hasIni = files.some((f) =>
    f.path.toLowerCase().endsWith("skin.ini") ||
    f.file.name.toLowerCase() === "skin.ini",
  );
  if (hasIni) {
    const map: FileMap = new Map();
    await Promise.all(
      files.map(async ({ path, file }) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        map.set(normalizePath(path), bytes);
      }),
    );
    return map;
  }
  if (osk) {
    return unzipSkinArchive(new Uint8Array(await osk.file.arrayBuffer()));
  }
  throw new Error("Drop an .osk or a folder that contains skin.ini");
}

export async function draftFromDataTransfer(
  dt: DataTransfer,
): Promise<ManiaSkinImportDraft> {
  const files = await collectDroppedFiles(dt);
  const name =
    files.find((f) => /\.osk$/i.test(f.file.name))?.file.name.replace(/\.osk$/i, "") ??
    "Imported skin";
  return buildManiaSkinDraft(await filesToMap(files), name);
}

export async function draftFromFileList(
  list: FileList | File[],
): Promise<ManiaSkinImportDraft> {
  const files = [...list].map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    return { path: rel && rel.length > 0 ? rel : file.name, file };
  });
  const name =
    files.find((f) => /\.osk$/i.test(f.file.name))?.file.name.replace(/\.osk$/i, "") ??
    "Imported skin";
  return buildManiaSkinDraft(await filesToMap(files), name);
}

function spritesFromCacheOrEmpty(keys: Keymode): ManiaSkinSprites {
  return spriteCache[keys] ?? emptySprites(keys);
}

export async function applyImportedManiaSkin(
  draft: ManiaSkinImportDraft,
  keymodes: Keymode[],
): Promise<void> {
  const skin = getPreviewSkin();
  const next = {
    ...skin,
    keymodes: { ...skin.keymodes },
  };
  for (const keys of keymodes) {
    const pack = draft.packs[keys];
    if (!pack) continue;
    await idbDeletePrefix(`${keys}:`);
    await idbPut(Object.entries(pack.blobs));
    spriteCache[keys] = pack.sprites;
    next.keymodes[keys] = {
      ...next.keymodes[keys],
      imported: pack.layout,
    };
  }
  setPreviewSkin(next);
  emitSprites();
}

export async function resetImportedKeymode(keys: Keymode): Promise<void> {
  await idbDeletePrefix(`${keys}:`);
  delete spriteCache[keys];
  const skin = getPreviewSkin();
  setPreviewSkin({
    ...skin,
    keymodes: {
      ...skin.keymodes,
      [keys]: defaultKeymodeSkin(keys),
    },
  });
  emitSprites();
}

export async function resetAllImported(): Promise<void> {
  await idbClear();
  spriteCache = {};
  resetPreviewSkin();
  emitSprites();
}

async function hydrateFromIdb(): Promise<void> {
  const rows = await idbGetAll();
  const grouped: Partial<Record<Keymode, ManiaSkinBlobs>> = {};
  for (const [key, blob] of rows) {
    const keys = Number(key.split(":")[0]) as Keymode;
    if (!KEYMODES.includes(keys)) continue;
    grouped[keys] ??= {};
    grouped[keys]![key] = blob;
  }
  for (const keys of KEYMODES) {
    const blobs = grouped[keys];
    if (!blobs) continue;
    const sprites = emptySprites(keys);
    const assign = async (
      kind: keyof ManiaSkinSprites,
      col?: number,
    ) => {
      const id = blobKey(keys, kind, col);
      const blob = blobs[id];
      if (!blob) return;
      try {
        const img = await createImageBitmap(blob);
        if (col == null) {
          if (
            kind === "stageLeft" ||
            kind === "stageRight" ||
            kind === "stageHint" ||
            kind === "stageBottom"
          ) {
            sprites[kind] = img;
          }
        } else if (
          kind === "notes" ||
          kind === "heads" ||
          kind === "bodies" ||
          kind === "tails" ||
          kind === "keysUp" ||
          kind === "keysDown"
        ) {
          sprites[kind][col] = img;
        }
      } catch {
        // skip broken blob
      }
    };
    const jobs: Promise<void>[] = [];
    for (let c = 0; c < keys; c += 1) {
      jobs.push(assign("notes", c));
      jobs.push(assign("heads", c));
      jobs.push(assign("bodies", c));
      jobs.push(assign("tails", c));
      jobs.push(assign("keysUp", c));
      jobs.push(assign("keysDown", c));
    }
    jobs.push(assign("stageLeft"));
    jobs.push(assign("stageRight"));
    jobs.push(assign("stageHint"));
    jobs.push(assign("stageBottom"));
    await Promise.all(jobs);
    spriteCache[keys] = sprites;
  }
  emitSprites();
}

export function ensureImportedSpritesLoaded(): void {
  if (loadStarted || typeof indexedDB === "undefined") return;
  loadStarted = true;
  void hydrateFromIdb();
}

/** Export every stored imported-skin sprite as a data URL keyed by its blob id. */
export async function exportImportedSpriteDataUrls(): Promise<
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

/** Restore exported sprites into IndexedDB and rehydrate the sprite cache. */
export async function importImportedSprites(
  entries: Record<string, string>,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const pairs: Array<[string, Blob]> = [];
  for (const [key, dataUrl] of Object.entries(entries)) {
    try {
      pairs.push([key, await (await fetch(dataUrl)).blob()]);
    } catch {
      // skip broken entry
    }
  }
  if (pairs.length === 0) return;
  await idbPut(pairs);
  spriteCache = {};
  loadStarted = false;
  ensureImportedSpritesLoaded();
}

export function getImportedManiaSprites(keys: number): ManiaSkinSprites | null {
  if (!KEYMODES.includes(keys as Keymode)) return null;
  return spriteCache[keys as Keymode] ?? null;
}

export async function loadImportedManiaSprites(
  keys: number,
): Promise<ManiaSkinSprites | null> {
  if (!KEYMODES.includes(keys as Keymode)) return null;
  if (!loadStarted) {
    loadStarted = true;
    await hydrateFromIdb();
  } else if (!spriteCache[keys as Keymode]) {
    await hydrateFromIdb();
  }
  return spriteCache[keys as Keymode] ?? null;
}

function subscribeSprites(onStoreChange: () => void): () => void {
  ensureImportedSpritesLoaded();
  window.addEventListener(SPRITE_EVENT, onStoreChange);
  return () => window.removeEventListener(SPRITE_EVENT, onStoreChange);
}

export function useImportedManiaSprites(keys: number): ManiaSkinSprites | null {
  useEffect(() => {
    ensureImportedSpritesLoaded();
  }, []);
  return useSyncExternalStore(
    subscribeSprites,
    () => getImportedManiaSprites(keys),
    () => null,
  );
}

export function skinImageSize(
  img: SkinImage | null | undefined,
): { w: number; h: number } | null {
  if (!img) return null;
  if (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement) {
    if (img.naturalWidth <= 0) return null;
    return { w: img.naturalWidth, h: img.naturalHeight };
  }
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
    return img.width > 0 ? { w: img.width, h: img.height } : null;
  }
  if (typeof HTMLCanvasElement !== "undefined" && img instanceof HTMLCanvasElement) {
    return img.width > 0 ? { w: img.width, h: img.height } : null;
  }
  if (typeof OffscreenCanvas !== "undefined" && img instanceof OffscreenCanvas) {
    return img.width > 0 ? { w: img.width, h: img.height } : null;
  }
  return null;
}

export { importedHitPositionFrac };

export function buildSampleManiaNotes(keys: number) {
  const notes: { column: number; startMs: number; endMs: number }[] = [];
  const pattern = [0, 1, 2, keys - 1, Math.floor(keys / 2), 0, keys - 2, 1];
  const totalNotes = 48;
  const spacing = 140;
  const holdDuration = 420;
  const releaseGap = 40;
  const minLongNotes = 10;
  const nextAvailable = Array(keys).fill(0);
  let t = 400;
  let longNotes = 0;

  for (let i = 0; i < totalNotes; i += 1) {
    const remaining = totalNotes - i;
    const mustMakeLong =
      longNotes < minLongNotes && remaining <= minLongNotes - longNotes;
    const wantsLong = mustMakeLong || i % 5 === 0;
    const preferred = pattern[i % pattern.length]! % keys;
    let column = -1;
    for (let offset = 0; offset < keys; offset += 1) {
      const c = (preferred + offset) % keys;
      if (t >= nextAvailable[c]) {
        column = c;
        break;
      }
    }
    if (column === -1) {
      t += spacing;
      i -= 1;
      continue;
    }
    const endMs = wantsLong ? t + holdDuration : t;
    notes.push({ column, startMs: t, endMs });
    if (wantsLong) {
      longNotes += 1;
      nextAvailable[column] = endMs + releaseGap;
    } else {
      nextAvailable[column] = t;
    }
    if (!wantsLong && i % 3 === 2) {
      const chordCol = (column + 2) % keys;
      if (t >= nextAvailable[chordCol]) {
        notes.push({ column: chordCol, startMs: t, endMs: t });
        nextAvailable[chordCol] = t;
      }
    }
    t += spacing;
  }
  return notes;
}
