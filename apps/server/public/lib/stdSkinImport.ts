import { unzipSync } from "fflate";
import { useSyncExternalStore } from "react";
import { sanitizeZipEntryPath } from "../../src/shared/zipEntryPath";
import {
  decodeSkinIniBytes,
  parseSkinIni,
  type SkinIniColours,
} from "./osuSkinIni";
import { type StdPlayfieldSprites } from "./paintStdPlayfield";
import { releaseSkinFields, releaseSkinImage } from "./skinImageRelease";
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
  layeredHitSounds: boolean;
  sprites: StdPlayfieldSprites;
  blobs: StdSkinBlobs;
};

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif"] as const;
const AUDIO_EXTS = ["wav", "ogg", "mp3"] as const;
const SPRITE_EVENT = "roxysu:std-imported-skin";
const DB_NAME = "roxysu-std-skin";
const DB_VERSION = 1;
const STORE = "sprites";
const KEY_PREFIX = "std:";
const HS_PREFIX = `${KEY_PREFIX}hs:`;

export const HITSOUND_SETS = ["normal", "soft", "drum"] as const;
export const HITSOUND_HITS = [
  "hitnormal",
  "hitwhistle",
  "hitfinish",
  "hitclap",
] as const;
export const HITSOUND_EXTRAS = [
  "slidertick",
  "sliderslide",
  "sliderwhistle",
  "spinnerspin",
  "spinnerbonus",
] as const;

type FileMap = Map<string, Uint8Array>;

let spriteCache: StdPlayfieldSprites | null = null;

function replaceSpriteCache(next: StdPlayfieldSprites | null): void {
  const previous = spriteCache;
  spriteCache = next;
  if (previous && previous !== next) releaseSkinFields(previous);
}
let hitsoundBufferCache: Record<string, AudioBuffer> | null = null;
let loadStarted = false;
/** Bumped on apply/reset so a stale hydrate cannot overwrite fresher sprites. */
let spriteEpoch = 0;

/** Sample key used by the player, e.g. `soft-hitclap` or `normal-hitnormal2`. */
export function hitsoundSampleKey(
  set: string,
  hit: string,
  index = 0,
): string {
  if (index >= 2) return `${set}-${hit}${index}`;
  return `${set}-${hit}`;
}

export function hitsoundBlobKey(sampleKey: string): string {
  return `${HS_PREFIX}${sampleKey}`;
}

/** Candidate file basenames (no extension) for a skin hitsound. */
export function hitsoundNameCandidates(
  set: string,
  hit: string,
  index = 0,
): string[] {
  const keyed = hitsoundSampleKey(set, hit, index);
  if (index >= 2) return [keyed];
  // Bare slidertick etc. sometimes shipped without a set prefix.
  if (
    (HITSOUND_EXTRAS as readonly string[]).includes(hit) &&
    set === "normal"
  ) {
    return [keyed, hit];
  }
  return [keyed];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripExt(path: string): string {
  return path.replace(/\.(png|jpe?g|gif|wav|ogg|mp3)$/i, "");
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

function lookupAudio(
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
    for (const ext of AUDIO_EXTS) {
      const hit = tryKey(`${base}.${ext}`);
      if (hit) return hit;
    }
  }

  const needle = noExt.split("/").pop()?.toLowerCase();
  if (!needle) return null;
  for (const ext of AUDIO_EXTS) {
    const suffix = `.${ext}`;
    for (const [path, bytes] of files) {
      if (
        path.toLowerCase().endsWith(`/${needle}${suffix}`) ||
        path.toLowerCase() === `${needle}${suffix}`
      ) {
        return bytes;
      }
    }
  }
  return null;
}

function scoopHitsoundBlobs(
  files: FileMap,
  root: string,
  blobs: StdSkinBlobs,
): void {
  for (const set of HITSOUND_SETS) {
    for (const hit of HITSOUND_HITS) {
      for (const index of [0, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const key = hitsoundSampleKey(set, hit, index);
        for (const name of hitsoundNameCandidates(set, hit, index)) {
          const bytes = lookupAudio(files, root, name);
          if (!bytes) continue;
          blobs[hitsoundBlobKey(key)] = new Blob([Uint8Array.from(bytes)]);
          break;
        }
      }
    }
    for (const extra of HITSOUND_EXTRAS) {
      const key = hitsoundSampleKey(set, extra, 0);
      for (const name of hitsoundNameCandidates(set, extra, 0)) {
        const bytes = lookupAudio(files, root, name);
        if (!bytes) continue;
        blobs[hitsoundBlobKey(key)] = new Blob([Uint8Array.from(bytes)]);
        break;
      }
    }
  }
}

type DecodedSkinImage = ImageBitmap | HTMLImageElement;

async function decodeImage(bytes: Uint8Array): Promise<DecodedSkinImage | null> {
  const copy = Uint8Array.from(bytes);
  const blob = new Blob([copy]);
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      if (bmp.width > 0 && bmp.height > 0) return bmp;
      bmp.close?.();
    } catch {
      // fall through to HTMLImageElement
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
    // Keep object URL alive for the image lifetime (session).
    (img as HTMLImageElement & { __blobUrl?: string }).__blobUrl = url;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) return img;
    URL.revokeObjectURL(url);
    return null;
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
  cache: Map<string, Promise<DecodedSkinImage | null>>,
  blobs: StdSkinBlobs,
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
  cache: Map<string, Promise<DecodedSkinImage | null>>,
  blobs: StdSkinBlobs,
): Promise<DecodedSkinImage[]> {
  const frames: DecodedSkinImage[] = [];
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

function emitSprites(reason: "change" | "hydrate" = "change"): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SPRITE_EVENT, { detail: { reason } }));
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
  const cache = new Map<string, Promise<DecodedSkinImage | null>>();
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
  scoopHitsoundBlobs(files, root, blobs);

  return {
    name: parsed.name || fallbackName || "Imported skin",
    colours: parsed.colours,
    layeredHitSounds: parsed.layeredHitSounds,
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
  if (colours.sliderBall) patch.sliderBall = colours.sliderBall;
  if (colours.spinnerBackground) patch.spinner = colours.spinnerBackground;
  if (colours.cursor) patch.cursor = colours.cursor;
  return patch;
}

export async function applyImportedStdSkin(
  draft: StdSkinImportDraft,
): Promise<void> {
  spriteEpoch += 1;
  const epoch = spriteEpoch;
  await idbClear();
  const entries = Object.entries(draft.blobs);
  await idbPut(entries);
  if (epoch !== spriteEpoch) return;
  replaceSpriteCache(draft.sprites);
  void decodeHitsoundBlobs(draft.blobs).then((buffers) => {
    if (epoch !== spriteEpoch) return;
    hitsoundBufferCache = buffers;
    emitSprites();
  });
  const meta: ImportedStdSkinMeta = {
    name: draft.name,
    colours: {
      comboColors: draft.colours.comboColors,
      sliderBorder: draft.colours.sliderBorder,
      sliderTrackOverride: draft.colours.sliderTrackOverride,
      sliderBall: draft.colours.sliderBall,
      spinnerBackground: draft.colours.spinnerBackground,
      cursor: draft.colours.cursor,
    },
    layeredHitSounds: draft.layeredHitSounds,
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
  spriteEpoch += 1;
  await idbClear();
  replaceSpriteCache(null);
  hitsoundBufferCache = null;
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

async function decodeBlob(
  blob: Blob,
): Promise<DecodedSkinImage | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return decodeImage(bytes);
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
  if (epoch !== spriteEpoch) {
    releaseSkinFields(sprites);
    return;
  }

  const ballFrames: DecodedSkinImage[] = [];
  for (let i = 0; i < 60; i += 1) {
    const row = rows.find(([k]) => k === blobKey("sliderball", i));
    if (!row) break;
    const img = await decodeBlob(row[1]);
    if (!img) break;
    ballFrames.push(img);
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
  if (epoch !== spriteEpoch) {
    releaseSkinFields(sprites);
    return;
  }

  const followFrames: DecodedSkinImage[] = [];
  for (let i = 0; i < 60; i += 1) {
    const row = rows.find(([k]) => k === blobKey("followpoint", i));
    if (!row) break;
    const img = await decodeBlob(row[1]);
    if (!img) break;
    followFrames.push(img);
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
  if (epoch !== spriteEpoch) {
    releaseSkinFields(sprites);
    return;
  }

  const defaults: Array<CanvasImageSource | null> = [];
  for (let d = 0; d <= 9; d += 1) {
    const row = rows.find(([k]) => k === blobKey("default", d));
    if (!row) {
      defaults.push(null);
      continue;
    }
    defaults.push(await decodeBlob(row[1]));
  }
  if (epoch !== spriteEpoch) {
    releaseSkinFields(sprites);
    for (const img of defaults) releaseSkinImage(img);
    return;
  }
  sprites.defaults = defaults;
  replaceSpriteCache(sprites);
  emitSprites("hydrate");

  const hsRows = rows.filter(([k]) => k.startsWith(HS_PREFIX));
  if (hsRows.length > 0) {
    const blobMap: StdSkinBlobs = {};
    for (const [k, blob] of hsRows) blobMap[k] = blob;
    const buffers = await decodeHitsoundBlobs(blobMap);
    if (epoch !== spriteEpoch) return;
    hitsoundBufferCache = buffers;
    emitSprites("hydrate");
  }
}

async function decodeHitsoundBlobs(
  blobs: StdSkinBlobs,
): Promise<Record<string, AudioBuffer>> {
  const out: Record<string, AudioBuffer> = {};
  if (typeof AudioContext === "undefined") return out;
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return out;
  }
  const entries = Object.entries(blobs).filter(([k]) => k.startsWith(HS_PREFIX));
  await Promise.all(
    entries.map(async ([key, blob]) => {
      try {
        const ab = await blob.arrayBuffer();
        const buffer = await ctx.decodeAudioData(ab.slice(0));
        const sampleKey = key.slice(HS_PREFIX.length);
        if (sampleKey) out[sampleKey] = buffer;
      } catch {
        // skip undecodable sample
      }
    }),
  );
  try {
    await ctx.close();
  } catch {
    // ignore
  }
  return out;
}

async function hydrateFromIdb(): Promise<void> {
  const epoch = spriteEpoch;
  const rows = await idbGetAll();
  if (epoch !== spriteEpoch) return;
  await hydrateSpritesFromRows(rows, epoch);
}

export function ensureImportedStdSpritesLoaded(): void {
  if (loadStarted || typeof indexedDB === "undefined") return;
  loadStarted = true;
  void hydrateFromIdb();
}

export function getImportedStdSprites(): StdPlayfieldSprites | null {
  return spriteCache;
}

export function getImportedStdHitsoundBuffers(): Record<
  string,
  AudioBuffer
> | null {
  return hitsoundBufferCache;
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
  const epoch = spriteEpoch;
  await hydrateSpritesFromRows(rows, epoch);
}

export function subscribeImportedStdSprites(
  onStoreChange: (event: Event) => void,
): () => void {
  window.addEventListener(SPRITE_EVENT, onStoreChange);
  return () => window.removeEventListener(SPRITE_EVENT, onStoreChange);
}

function subscribeSprites(onStoreChange: () => void): () => void {
  ensureImportedStdSpritesLoaded();
  return subscribeImportedStdSprites(onStoreChange);
}

export function useImportedStdSprites(): StdPlayfieldSprites | null {
  return useSyncExternalStore(
    subscribeSprites,
    getImportedStdSprites,
    () => null,
  );
}
