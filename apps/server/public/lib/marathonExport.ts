import { Zip, ZipPassThrough } from "fflate";
import { fuseManiaCharts } from "@roxysu/osu-chart";
import { localBeatmapAudioUrl, localBeatmapCoverUrl } from "./osuUrls";

const TARGET_RATE = 44100;
const SILENCE_PEAK = 0.0001;
const COLLAGE_W = 1920;
const COLLAGE_H = 1080;

export type MarathonExportProgress =
  | { phase: "audio"; index: number; total: number }
  | { phase: "encode" }
  | { phase: "collage" }
  | { phase: "pack" }
  | { phase: "import" }
  | { phase: "done" };

export type MarathonSourceInput = {
  osuText: string;
  audioFileHash: string;
  backgroundFileHash: string | null;
};

export function collageGrid(count: number): { cols: number; rows: number } {
  const n = Math.max(1, count);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  return { cols, rows };
}

export function encodePcmWav(
  channels: Float32Array[],
  sampleRate: number,
): Uint8Array {
  const ch = Math.min(2, Math.max(1, channels.length));
  const frames = channels[0]?.length ?? 0;
  const dataSize = frames * ch * 2;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  writeAscii(out, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(out, 8, "WAVE");
  writeAscii(out, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(out, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < ch; c += 1) {
      const sample = Math.max(-1, Math.min(1, channels[c]![i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

const BYTES_PER_FRAME = 4;

/**
 * Longest marathon the browser export will build. 16-bit stereo 44.1 kHz PCM is
 * about 10.6 MB per minute, so one hour is roughly 635 MB held in memory.
 */
export const MARATHON_MAX_DURATION_SEC = 60 * 60;

/** Interleave a stereo pair as signed 16-bit little-endian PCM. */
export function pcm16Interleave(
  left: Float32Array,
  right: Float32Array,
): Uint8Array {
  const frames = Math.min(left.length, right.length);
  const out = new Uint8Array(frames * BYTES_PER_FRAME);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (let i = 0; i < frames; i += 1) {
    const l = Math.max(-1, Math.min(1, left[i] ?? 0));
    const r = Math.max(-1, Math.min(1, right[i] ?? 0));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += BYTES_PER_FRAME;
  }
  return out;
}

function stereoWavHeader(dataSize: number, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44);
  const view = new DataView(out.buffer);
  writeAscii(out, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(out, 8, "WAVE");
  writeAscii(out, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_FRAME, true);
  view.setUint16(32, BYTES_PER_FRAME, true);
  view.setUint16(34, 16, true);
  writeAscii(out, 36, "data");
  view.setUint32(40, dataSize, true);
  return out;
}

/** Wrap already-encoded stereo 16-bit PCM chunks in one WAV file. */
export function assembleStereoWav(
  pcmChunks: Uint8Array[],
  sampleRate: number,
): Uint8Array {
  let dataSize = 0;
  for (const chunk of pcmChunks) dataSize += chunk.byteLength;
  const out = new Uint8Array(44 + dataSize);
  out.set(stereoWavHeader(dataSize, sampleRate));
  let offset = 44;
  for (const chunk of pcmChunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Concatenate tracks one at a time as 16-bit PCM chunks. Only one decoded
 * track is alive at once and the mix is held as PCM16 (half the size of a
 * float32 stereo pair), never as a float copy of the whole marathon.
 */
export async function mixTracksToWav(args: {
  count: number;
  /** Return one track already resampled to stereo `TARGET_RATE`. */
  loadTrack: (index: number) => Promise<[Float32Array, Float32Array]>;
  pauseMs: number;
  maxDurationSec?: number;
  signal?: AbortSignal;
}): Promise<{ chunks: Uint8Array[]; durationsMs: number[] }> {
  const { count, loadTrack, pauseMs, signal } = args;
  const maxFrames = Math.round(
    (args.maxDurationSec ?? MARATHON_MAX_DURATION_SEC) * TARGET_RATE,
  );
  const pauseFrames = Math.max(0, Math.round((pauseMs / 1000) * TARGET_RATE));
  const pauseChunk = new Uint8Array(pauseFrames * BYTES_PER_FRAME);
  const chunks: Uint8Array[] = [];
  const durationsMs: number[] = [];
  let totalFrames = 0;
  let peak = 0;

  for (let i = 0; i < count; i += 1) {
    throwIfAborted(signal);
    const track = await loadTrack(i);
    throwIfAborted(signal);
    const frames = Math.min(track[0].length, track[1].length);
    totalFrames += frames + (i < count - 1 ? pauseFrames : 0);
    if (totalFrames > maxFrames) {
      const limitMin = Math.round(maxFrames / TARGET_RATE / 60);
      throw new Error(
        `Marathon audio is longer than the ${limitMin} minute limit; remove some maps`,
      );
    }
    durationsMs.push(Math.round((frames / TARGET_RATE) * 1000));
    for (let f = 0; f < frames && peak <= SILENCE_PEAK; f += 1) {
      peak = Math.max(peak, Math.abs(track[0][f] ?? 0), Math.abs(track[1][f] ?? 0));
    }
    chunks.push(pcm16Interleave(track[0], track[1]));
    if (i < count - 1 && pauseFrames > 0) chunks.push(pauseChunk);
  }

  if (peak <= SILENCE_PEAK) throw new Error("Concatenated audio is silent");
  throwIfAborted(signal);
  return { chunks, durationsMs };
}

/**
 * Store the WAV (header, then each PCM chunk) and the small chart files.
 * PCM is not deflated and is not copied into a second WAV buffer.
 */
export function packMarathonArchive(args: {
  audioName: string;
  pcmChunks: Uint8Array[];
  osuName: string;
  osuBytes: Uint8Array;
  background?: { filename: string; bytes: Uint8Array };
}): Blob {
  const parts: Uint8Array[] = [];
  let zipError: unknown = null;
  const zip = new Zip((err, data) => {
    if (zipError) return;
    if (err) {
      zipError = err;
      return;
    }
    if (data.length) parts.push(data);
  });

  const audio = new ZipPassThrough(args.audioName);
  zip.add(audio);
  let dataSize = 0;
  for (const chunk of args.pcmChunks) dataSize += chunk.byteLength;
  audio.push(stereoWavHeader(dataSize, TARGET_RATE), false);
  for (let i = 0; i < args.pcmChunks.length; i += 1) {
    const chunk = args.pcmChunks[i]!;
    args.pcmChunks[i] = undefined as unknown as Uint8Array;
    audio.push(chunk, false);
  }
  args.pcmChunks.length = 0;
  audio.push(new Uint8Array(0), true);

  const osu = new ZipPassThrough(args.osuName);
  zip.add(osu);
  osu.push(args.osuBytes, true);
  if (args.background) {
    const bg = new ZipPassThrough(args.background.filename);
    zip.add(bg);
    bg.push(args.background.bytes, true);
  }
  zip.end();
  if (zipError) throw zipError;
  return new Blob(parts, { type: "application/octet-stream" });
}

export function sanitizeMarathonFilename(name: string): string {
  const base = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const safe = base.length > 0 ? base : "marathon";
  return safe.toLowerCase().endsWith(".osz") ? safe : `${safe}.osz`;
}

export async function generateMarathonOsz(args: {
  sources: MarathonSourceInput[];
  pauseMs: number;
  title: string;
  artist: string;
  version: string;
  signal?: AbortSignal;
  onProgress?: (p: MarathonExportProgress) => void;
}): Promise<{ blob: Blob; filename: string; audioName: string }> {
  const { sources, pauseMs, title, artist, version, signal, onProgress } = args;
  if (sources.length < 2) throw new Error("Need at least two maps");

  const mixed = await mixTracksToWav({
    count: sources.length,
    pauseMs,
    signal,
    loadTrack: async (i) => {
      onProgress?.({ phase: "audio", index: i, total: sources.length });
      const url = localBeatmapAudioUrl(sources[i]!.audioFileHash);
      if (!url) throw new Error(`Audio missing for map ${i + 1}`);
      return toStereo44100(await decodeAudio(url, signal));
    },
  });
  const audioName = "audio.wav";
  const durationsMs = mixed.durationsMs;

  throwIfAborted(signal);
  onProgress?.({ phase: "collage" });
  const bg = await buildCollage(
    sources.map((s) => s.backgroundFileHash),
    signal,
  );

  throwIfAborted(signal);
  onProgress?.({ phase: "pack" });
  const fused = fuseManiaCharts(
    sources.map((s, i) => ({
      osuText: s.osuText,
      audioDurationMs: durationsMs[i]!,
    })),
    {
      pauseMs,
      metadata: {
        title,
        artist,
        creator: "Roxysu",
        version,
        audioFilename: audioName,
        backgroundFilename: bg?.filename,
        previewTime: 0,
        tags: "roxysu marathon",
      },
    },
  );

  const osuName = `${sanitizeArchiveStem(artist)} - ${sanitizeArchiveStem(title)} [${sanitizeArchiveStem(version)}].osu`;
  const filename = sanitizeMarathonFilename(`${artist} - ${title}`);
  return {
    blob: packMarathonArchive({
      audioName,
      pcmChunks: mixed.chunks,
      osuName,
      osuBytes: new TextEncoder().encode(fused.osuText),
      background: bg ?? undefined,
    }),
    filename,
    audioName,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Export cancelled", "AbortError");
  }
}

async function decodeAudio(
  url: string,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Failed to fetch audio (${res.status})`);
  const raw = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(raw);
  } finally {
    void ctx.close();
  }
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const denom = Math.max(1, outLen - 1);
  const ratio = (input.length - 1) / denom;
  for (let i = 0; i < outLen; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - t) + (input[i1] ?? 0) * t;
  }
  return out;
}

function toStereo44100(buffer: AudioBuffer): [Float32Array, Float32Array] {
  const left = resample(buffer.getChannelData(0), buffer.sampleRate, TARGET_RATE);
  const rightSrc =
    buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0);
  const right = resample(rightSrc, buffer.sampleRate, TARGET_RATE);
  const n = Math.min(left.length, right.length);
  return [left.subarray(0, n), right.subarray(0, n)];
}

async function buildCollage(
  hashes: Array<string | null>,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const urls = hashes
    .map((hash) => localBeatmapCoverUrl(hash))
    .filter((url): url is string => url != null);
  if (urls.length === 0) return null;

  const images: HTMLImageElement[] = [];
  for (const url of urls) {
    throwIfAborted(signal);
    images.push(await loadImage(url, signal));
  }

  const { cols, rows } = collageGrid(images.length);
  const canvas = document.createElement("canvas");
  canvas.width = COLLAGE_W;
  canvas.height = COLLAGE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, COLLAGE_W, COLLAGE_H);

  const cellW = COLLAGE_W / cols;
  const cellH = COLLAGE_H / rows;
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    drawCover(ctx, img, col * cellW, row * cellH, cellW, cellH);
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
  });
  if (!blob) return null;
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    filename: "bg.jpg",
  };
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (srcW <= 0 || srcH <= 0) return;
  const scale = Math.max(w / srcW, h / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function loadImage(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const onAbort = () => {
      img.src = "";
      reject(new DOMException("Export cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    img.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(img);
    };
    img.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Failed to load background"));
    };
    img.src = url;
  });
}

function writeAscii(buf: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    buf[offset + i] = text.charCodeAt(i);
  }
}

function sanitizeArchiveStem(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "map";
}

/**
 * Keep only sources whose key count matches the marathon's key count. The
 * reference is the first existing track with a key count, else the first
 * incoming source. `referenceKeyCount` is null when nothing is constrained.
 */
export function partitionByKeyCount<T extends { keyCount: number | null }>(
  existing: readonly { keyCount: number | null }[],
  incoming: readonly T[],
): { accepted: T[]; rejected: T[]; referenceKeyCount: number | null } {
  const referenceKeyCount =
    existing.find((t) => t.keyCount != null)?.keyCount ??
    incoming.find((t) => t.keyCount != null)?.keyCount ??
    null;
  if (referenceKeyCount == null) {
    return { accepted: [...incoming], rejected: [], referenceKeyCount };
  }
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const src of incoming) {
    (src.keyCount === referenceKeyCount ? accepted : rejected).push(src);
  }
  return { accepted, rejected, referenceKeyCount };
}
