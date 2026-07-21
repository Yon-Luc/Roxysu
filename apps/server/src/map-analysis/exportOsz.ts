import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { beatmaps, type Db } from "@roxysu/db/client.bun";
import { getOsuDataPath, resolveLazerFilePath } from "../shared/lazer-files";
import { buildZip, type ZipEntry } from "./zipStore";

export const COLLECTION_EXPORT_MAX_SETS = 100;

export type OszPack = {
  bytes: Uint8Array;
  filename: string;
};

export type OszBuildError = {
  error: string;
  status: 404 | 400;
};

type BeatmapExportRow = {
  id: string;
  setId: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  hash: string | null;
  audioFile: string | null;
  audioFileHash: string | null;
  backgroundFile: string | null;
  backgroundFileHash: string | null;
};

const selectExportCols = {
  id: beatmaps.id,
  setId: beatmaps.setId,
  title: beatmaps.title,
  artist: beatmaps.artist,
  difficultyName: beatmaps.difficultyName,
  hash: beatmaps.hash,
  audioFile: beatmaps.audioFile,
  audioFileHash: beatmaps.audioFileHash,
  backgroundFile: beatmaps.backgroundFile,
  backgroundFileHash: beatmaps.backgroundFileHash,
} as const;

/** Strip path traversal and Windows-hostile characters from archive names. */
export function sanitizeArchiveName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .pop()
    ?.replace(/[<>:"|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned && cleaned.length > 0 ? cleaned : fallback;
}

export function sanitizeDownloadFilename(name: string, ext: string): string {
  const base = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const safe = base.length > 0 ? base : "export";
  const suffix = ext.startsWith(".") ? ext : `.${ext}`;
  return safe.toLowerCase().endsWith(suffix.toLowerCase())
    ? safe
    : `${safe}${suffix}`;
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function oszContentDisposition(filename: string): string {
  return contentDisposition(filename);
}

function sniffExtension(bytes: Uint8Array, kind: "audio" | "image"): string {
  if (kind === "audio") {
    if (
      bytes.length >= 3 &&
      bytes[0] === 0x49 &&
      bytes[1] === 0x44 &&
      bytes[2] === 0x33
    ) {
      return ".mp3";
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) {
      return ".mp3";
    }
    if (
      bytes.length >= 4 &&
      bytes[0] === 0x4f &&
      bytes[1] === 0x67 &&
      bytes[2] === 0x67 &&
      bytes[3] === 0x53
    ) {
      return ".ogg";
    }
    if (
      bytes.length >= 4 &&
      bytes[0] === 0x66 &&
      bytes[1] === 0x4c &&
      bytes[2] === 0x61 &&
      bytes[3] === 0x43
    ) {
      return ".flac";
    }
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46
    ) {
      return ".wav";
    }
    return ".mp3";
  }

  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return ".png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return ".jpg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return ".webp";
  }
  return ".jpg";
}

function parseOsuFilenames(osuText: string): {
  audioFilename: string | null;
  backgroundFilename: string | null;
} {
  let audioFilename: string | null = null;
  let backgroundFilename: string | null = null;

  for (const raw of osuText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!audioFilename && line.toLowerCase().startsWith("audiofilename:")) {
      const value = line.slice(line.indexOf(":") + 1).trim();
      if (value) audioFilename = value;
      continue;
    }
    if (backgroundFilename) continue;
    // Background: 0,0,"file.jpg",0,0
    if (line.startsWith("0,") || line.startsWith("Background,")) {
      const match = line.match(/"([^"]+)"/);
      if (match?.[1]) backgroundFilename = match[1];
    }
  }

  return { audioFilename, backgroundFilename };
}

function readLazerBytes(hash: string | null): Uint8Array | null {
  if (!hash) return null;
  const path = resolveLazerFilePath(hash, getOsuDataPath());
  if (!path) return null;
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return null;
  }
}

function osuEntryName(row: BeatmapExportRow, osuText: string): string {
  const fromMeta = (() => {
    const artist = row.artist?.trim() || "Unknown";
    const title = row.title?.trim() || "Unknown";
    const diff = row.difficultyName?.trim() || "Normal";
    return `${artist} - ${title} [${diff}].osu`;
  })();

  // Prefer Version from [Metadata] if present for uniqueness within a set.
  let version: string | null = null;
  for (const raw of osuText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.toLowerCase().startsWith("version:")) {
      version = line.slice(line.indexOf(":") + 1).trim() || null;
      break;
    }
  }
  if (version) {
    const artist = row.artist?.trim() || "Unknown";
    const title = row.title?.trim() || "Unknown";
    return sanitizeArchiveName(
      `${artist} - ${title} [${version}].osu`,
      fromMeta,
    );
  }
  return sanitizeArchiveName(fromMeta, "beatmap.osu");
}

function packRows(rows: BeatmapExportRow[]): OszPack | OszBuildError {
  if (rows.length === 0) {
    return { error: "No beatmaps to export", status: 404 };
  }

  const entries: ZipEntry[] = [];
  const seenNames = new Set<string>();
  let firstOsuText: string | null = null;
  let anyOsu = false;

  for (const row of rows) {
    const osuBytes = readLazerBytes(row.hash);
    if (!osuBytes) continue;
    anyOsu = true;
    const osuText = new TextDecoder("utf-8", { fatal: false }).decode(osuBytes);
    if (!firstOsuText) firstOsuText = osuText;

    let name = osuEntryName(row, osuText);
    if (seenNames.has(name.toLowerCase())) {
      name = sanitizeArchiveName(`${row.id}.osu`, `${row.id}.osu`);
    }
    seenNames.add(name.toLowerCase());
    entries.push({ name, data: osuBytes });
  }

  if (!anyOsu) {
    return { error: "Beatmap file not found in lazer files store", status: 404 };
  }

  const primary = rows[0]!;
  const parsed = firstOsuText
    ? parseOsuFilenames(firstOsuText)
    : { audioFilename: null, backgroundFilename: null };

  let audioBytes: Uint8Array | null = null;
  let audioNameHint: string | null = null;
  for (const row of rows) {
    const bytes = readLazerBytes(row.audioFileHash);
    if (bytes) {
      audioBytes = bytes;
      audioNameHint = row.audioFile;
      break;
    }
  }
  if (audioBytes) {
    const preferred =
      audioNameHint || parsed.audioFilename || null;
    const name = sanitizeArchiveName(
      preferred ?? `audio${sniffExtension(audioBytes, "audio")}`,
      `audio${sniffExtension(audioBytes, "audio")}`,
    );
    if (!seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      entries.push({ name, data: audioBytes });
    }
  }

  // Prefer a background that exists; walk rows in case diffs differ.
  let bgBytes: Uint8Array | null = null;
  let bgNameHint: string | null = null;
  for (const row of rows) {
    const bytes = readLazerBytes(row.backgroundFileHash);
    if (bytes) {
      bgBytes = bytes;
      bgNameHint = row.backgroundFile;
      break;
    }
  }
  if (bgBytes) {
    const preferred =
      bgNameHint || parsed.backgroundFilename || null;
    const name = sanitizeArchiveName(
      preferred ?? `bg${sniffExtension(bgBytes, "image")}`,
      `bg${sniffExtension(bgBytes, "image")}`,
    );
    if (!seenNames.has(name.toLowerCase())) {
      seenNames.add(name.toLowerCase());
      entries.push({ name, data: bgBytes });
    }
  }

  const artist = primary.artist?.trim() || "Unknown";
  const title = primary.title?.trim() || "Unknown";
  const filename =
    rows.length === 1 && primary.difficultyName
      ? sanitizeDownloadFilename(
          `${artist} - ${title} [${primary.difficultyName}]`,
          ".osz",
        )
      : sanitizeDownloadFilename(`${artist} - ${title}`, ".osz");

  return { bytes: buildZip(entries), filename };
}

async function loadBeatmap(
  db: Db,
  beatmapId: string,
): Promise<BeatmapExportRow | null> {
  const [row] = await db
    .select(selectExportCols)
    .from(beatmaps)
    .where(eq(beatmaps.id, beatmapId))
    .limit(1);
  return row ?? null;
}

async function loadSetBeatmaps(
  db: Db,
  setId: string,
): Promise<BeatmapExportRow[]> {
  return db
    .select(selectExportCols)
    .from(beatmaps)
    .where(eq(beatmaps.setId, setId));
}

/** Pack a single difficulty into an `.osz`. */
export async function buildDifficultyOsz(
  db: Db,
  beatmapId: string,
): Promise<OszPack | OszBuildError> {
  const row = await loadBeatmap(db, beatmapId);
  if (!row) return { error: "Beatmap not found", status: 404 };
  return packRows([row]);
}

/** Pack every difficulty in a beatmap set into one `.osz`. */
export async function buildSetOsz(
  db: Db,
  setId: string,
): Promise<OszPack | OszBuildError> {
  const rows = await loadSetBeatmaps(db, setId);
  if (rows.length === 0) return { error: "Beatmap set not found", status: 404 };
  return packRows(rows);
}

/** Resolve a beatmap id → its set, then pack the full set. */
export async function buildSetOszForBeatmap(
  db: Db,
  beatmapId: string,
): Promise<OszPack | OszBuildError> {
  const row = await loadBeatmap(db, beatmapId);
  if (!row) return { error: "Beatmap not found", status: 404 };
  return buildSetOsz(db, row.setId);
}

/**
 * Pack each unique set among `setIds` into its own `.osz`, then wrap in an
 * outer ZIP. Skips sets that fail to pack. Errors if none succeed.
 */
export async function buildCollectionExportZip(
  db: Db,
  setIds: string[],
  collectionName: string,
): Promise<OszPack | OszBuildError> {
  const unique = [...new Set(setIds.filter(Boolean))];
  if (unique.length === 0) {
    return { error: "No beatmaps to export", status: 404 };
  }
  if (unique.length > COLLECTION_EXPORT_MAX_SETS) {
    return {
      error: `Collection has ${unique.length} sets; export is limited to ${COLLECTION_EXPORT_MAX_SETS}. Narrow the query and try again.`,
      status: 400,
    };
  }

  const allRows = await db
    .select(selectExportCols)
    .from(beatmaps)
    .where(inArray(beatmaps.setId, unique));

  const bySet = new Map<string, BeatmapExportRow[]>();
  for (const row of allRows) {
    const list = bySet.get(row.setId);
    if (list) list.push(row);
    else bySet.set(row.setId, [row]);
  }

  const outer: ZipEntry[] = [];
  const usedNames = new Set<string>();

  for (const setId of unique) {
    const rows = bySet.get(setId);
    if (!rows || rows.length === 0) continue;
    const pack = packRows(rows);
    if ("error" in pack) continue;

    let name = pack.filename;
    if (usedNames.has(name.toLowerCase())) {
      name = sanitizeDownloadFilename(`${setId}`, ".osz");
    }
    usedNames.add(name.toLowerCase());
    outer.push({ name, data: pack.bytes });
  }

  if (outer.length === 0) {
    return {
      error: "Could not pack any beatmap sets from this collection",
      status: 404,
    };
  }

  return {
    bytes: buildZip(outer),
    filename: sanitizeDownloadFilename(collectionName || "collection", ".zip"),
  };
}

export function isOszBuildError(
  value: OszPack | OszBuildError,
): value is OszBuildError {
  return "error" in value;
}
