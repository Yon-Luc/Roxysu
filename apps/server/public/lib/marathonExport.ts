import { zipSync } from "fflate";
import { fuseManiaCharts } from "@roxysu/osu-chart";
import { localBeatmapAudioUrl, localBeatmapCoverUrl } from "./osuUrls";

const TARGET_RATE = 44100;
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

  const decoded: AudioBuffer[] = [];
  for (let i = 0; i < sources.length; i += 1) {
    throwIfAborted(signal);
    onProgress?.({ phase: "audio", index: i, total: sources.length });
    const url = localBeatmapAudioUrl(sources[i]!.audioFileHash);
    if (!url) throw new Error(`Audio missing for map ${i + 1}`);
    decoded.push(await decodeAudio(url, signal));
  }

  throwIfAborted(signal);
  onProgress?.({ phase: "encode" });
  const mixed = mixAudio(decoded, pauseMs / 1000);
  const encoded = encodeAudio(mixed.buffer);
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
        audioFilename: encoded.filename,
        backgroundFilename: bg?.filename,
        previewTime: 0,
        tags: "roxysu marathon",
      },
    },
  );

  const osuName = `${sanitizeArchiveStem(artist)} - ${sanitizeArchiveStem(title)} [${sanitizeArchiveStem(version)}].osu`;
  const files: Record<string, Uint8Array> = {
    [osuName]: new TextEncoder().encode(fused.osuText),
    [encoded.filename]: encoded.bytes,
  };
  if (bg) files[bg.filename] = bg.bytes;

  const zipped = zipSync(files);
  const filename = sanitizeMarathonFilename(`${artist} - ${title}`);
  return {
    blob: new Blob([zipped], { type: "application/octet-stream" }),
    filename,
    audioName: encoded.filename,
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
    return await ctx.decodeAudioData(raw.slice(0));
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

function mixAudio(
  buffers: AudioBuffer[],
  pauseSec: number,
): { buffer: AudioBuffer; durationsMs: number[] } {
  const parts: Array<[Float32Array, Float32Array]> = buffers.map(toStereo44100);
  const pauseFrames = Math.max(0, Math.round(pauseSec * TARGET_RATE));
  const durationsMs = parts.map((part) =>
    Math.round((part[0].length / TARGET_RATE) * 1000),
  );
  let total = 0;
  for (let i = 0; i < parts.length; i += 1) {
    total += parts[i]![0].length;
    if (i < parts.length - 1) total += pauseFrames;
  }
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let offset = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const [l, r] = parts[i]!;
    left.set(l, offset);
    right.set(r, offset);
    offset += l.length;
    if (i < parts.length - 1) offset += pauseFrames;
  }
  const out = new AudioBuffer({
    length: total,
    numberOfChannels: 2,
    sampleRate: TARGET_RATE,
  });
  out.copyToChannel(left, 0);
  out.copyToChannel(right, 1);
  return { buffer: out, durationsMs };
}

function encodeAudio(
  buffer: AudioBuffer,
): { bytes: Uint8Array; filename: string } {
  const left = buffer.getChannelData(0);
  const right =
    buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  let peak = 0;
  for (let i = 0; i < left.length; i += 1) {
    peak = Math.max(peak, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
    if (peak > 0.0001) break;
  }
  if (peak <= 0.0001) {
    throw new Error("Concatenated audio is silent");
  }
  return {
    bytes: encodePcmWav([left, right], buffer.sampleRate),
    filename: "audio.wav",
  };
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
