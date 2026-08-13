/**
 * Offline deterministic score-rewatch → MP4 export via mediabunny.
 *
 * Composites a frame that mirrors the rewatch UI: background, top-left title /
 * mods, playfield at modal-like scale with the user's skin, combo/accuracy HUD,
 * and bottom stats — without control buttons.
 */
import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  Quality,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import { formatModAcronym, parseModEntries } from "@server/replay/mods";
import type { ScoreReplay } from "./api";
import {
  formatAccuracy,
  clamp,
} from "./format";
import {
  localBeatmapAudioUrl,
  localBeatmapCoverUrl,
  osuBeatmapCoverUrl,
} from "./osuUrls";
import {
  buildComboNumbers,
  buildHeadMap,
  paintStdPlayfield,
  type CursorTrailPoint,
  type StdPlayfieldJudgment,
} from "./paintStdPlayfield";
import {
  buildHeadJudgmentMap,
  clampScrollSpeed,
  JUDGMENT_COLORS,
  paintManiaNotefield,
  PREVIEW_SCROLL_DEFAULT,
  type NotefieldJudgment,
  type ReplayJudgmentResult,
} from "./paintManiaNotefield";
import {
  getPreviewSkin,
  resolveKeymodeSkin,
  HIT_POSITION_MAX,
  HIT_POSITION_MIN,
  LANE_COVER_MAX,
  LANE_COVER_MIN,
  type KeymodeSkin,
  type PreviewSkin,
} from "./previewSkin";
import { getStdSkin, type StdSkin } from "./stdSkin";
import {
  FIELD_WIDTH_DEFAULT,
  FIELD_WIDTH_MAX,
  FIELD_WIDTH_MIN,
} from "../components/previewPrefs";
import roxyIconUrl from "../roxy.png";

export const REPLAY_VIDEO_WIDTH = 1920;
export const REPLAY_VIDEO_HEIGHT = 1080;
export const REPLAY_VIDEO_FPS = 60;

/** Discord's common free-tier upload ceiling (bytes). Used for UI hints + bitrate caps. */
export const DISCORD_UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

export type ReplayVideoQualityLevel = "low" | "medium" | "high" | "veryHigh";

export type ReplayVideoExportPresetId =
  | "discord"
  | "tiktok"
  | "720"
  | "1080"
  | "compact";

export type ReplayVideoHudPlacement = "overlay" | "below";

export type ReplayVideoExportPreset = {
  id: ReplayVideoExportPresetId;
  label: string;
  /** Short blurb under the preset name. */
  description: string;
  /** Max canvas width (tight-crop presets use this as an upper bound). */
  width: number;
  /** Max canvas height (tight-crop presets use this as an upper bound). */
  height: number;
  fps: number;
  quality: ReplayVideoQualityLevel;
  /** Default for the hide-background toggle when this preset is selected. */
  hideBackgroundDefault: boolean;
  /** Nominal video bitrate used only for size estimates (Mbps). */
  estimateVideoMbps: number;
  /** Nominal audio bitrate used only for size estimates (kbps). */
  estimateAudioKbps: number;
  /** Crop canvas to header + playfield + footer (no empty sidebars). */
  tightCrop?: boolean;
  /** Where combo/accuracy sit relative to the playfield. */
  hudPlacement?: ReplayVideoHudPlacement;
  /** Skip idle lead-in / outro around the chart. */
  trimIdle?: boolean;
  /** Cap encode bitrate to aim under this many bytes (e.g. Discord 20 MB). */
  fitUnderBytes?: number;
};

export const REPLAY_VIDEO_EXPORT_PRESETS: ReplayVideoExportPreset[] = [
  {
    id: "discord",
    label: "Discord",
    description:
      "Tight crop, HUD below, trimmed idle, bitrate capped for ~20 MB",
    width: 1280,
    height: 720,
    fps: 30,
    quality: "high",
    hideBackgroundDefault: true,
    estimateVideoMbps: 4,
    estimateAudioKbps: 128,
    tightCrop: true,
    hudPlacement: "below",
    trimIdle: true,
    fitUnderBytes: DISCORD_UPLOAD_LIMIT_BYTES,
  },
  {
    id: "tiktok",
    label: "TikTok / HQ",
    description:
      "Same tight crop as Discord, higher quality @ 60fps (no 20 MB cap)",
    width: 1440,
    height: 1080,
    fps: 60,
    quality: "veryHigh",
    hideBackgroundDefault: true,
    estimateVideoMbps: 6,
    estimateAudioKbps: 128,
    tightCrop: true,
    hudPlacement: "below",
    trimIdle: true,
  },
  {
    id: "720",
    label: "720p",
    description: "1280×720 @ 60fps with beatmap background",
    width: 1280,
    height: 720,
    fps: 60,
    quality: "high",
    hideBackgroundDefault: false,
    estimateVideoMbps: 5,
    estimateAudioKbps: 128,
    hudPlacement: "overlay",
    trimIdle: true,
  },
  {
    id: "1080",
    label: "1080p",
    description: "1920×1080 @ 60fps — closest to the rewatch page",
    width: 1920,
    height: 1080,
    fps: 60,
    quality: "high",
    hideBackgroundDefault: false,
    estimateVideoMbps: 10,
    estimateAudioKbps: 160,
    hudPlacement: "overlay",
    trimIdle: true,
  },
  {
    id: "compact",
    label: "Compact",
    description: "Tight 480p30 crop, HUD below, trimmed idle",
    width: 854,
    height: 480,
    fps: 30,
    quality: "low",
    hideBackgroundDefault: true,
    estimateVideoMbps: 1.2,
    estimateAudioKbps: 96,
    tightCrop: true,
    hudPlacement: "below",
    trimIdle: true,
    fitUnderBytes: DISCORD_UPLOAD_LIMIT_BYTES,
  },
];

export function getReplayVideoExportPreset(
  id: ReplayVideoExportPresetId,
): ReplayVideoExportPreset {
  return (
    REPLAY_VIDEO_EXPORT_PRESETS.find((p) => p.id === id) ??
    REPLAY_VIDEO_EXPORT_PRESETS.find((p) => p.id === "1080") ??
    REPLAY_VIDEO_EXPORT_PRESETS[0]!
  );
}

function qualityFromLevel(level: ReplayVideoQualityLevel): Quality {
  switch (level) {
    case "low":
      return QUALITY_LOW;
    case "medium":
      return QUALITY_MEDIUM;
    case "veryHigh":
      return QUALITY_VERY_HIGH;
    case "high":
    default:
      return QUALITY_HIGH;
  }
}

/**
 * Size estimate for a clip.
 * Discord/Compact (`fitUnderBytes`) use the same bitrate math as the encoder so
 * the UI matches the target file size.
 */
export function estimateReplayVideoBytes(
  durationSec: number,
  preset: ReplayVideoExportPreset,
  hideBackground: boolean,
): number {
  const sec = Math.max(1, durationSec);
  if (preset.fitUnderBytes != null) {
    const { videoBps, audioBps } = computeFitBitrates(
      sec,
      preset.fitUnderBytes,
      preset.estimateAudioKbps,
    );
    return Math.round(((videoBps + audioBps) * sec) / 8);
  }
  const bgFactor = hideBackground ? 0.72 : 1;
  const cropFactor = preset.tightCrop ? 0.55 : 1;
  const videoBits =
    preset.estimateVideoMbps * 1e6 * bgFactor * cropFactor * sec;
  const audioBits = preset.estimateAudioKbps * 1e3 * sec;
  return Math.round(((videoBits + audioBits) / 8) * 1.03);
}

export function formatExportByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return mb >= 10 ? `${mb.toFixed(0)} MB` : `${mb.toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Encode bitrates aimed under `limitBytes` for a known duration.
 * Uses most of the Discord budget so short maps get higher quality.
 */
export function computeFitBitrates(
  durationSec: number,
  limitBytes: number,
  audioKbps: number,
): { videoBps: number; audioBps: number } {
  const sec = Math.max(1, durationSec);
  // ~4% headroom for mux/container; CBR should land close to this.
  const budgetBits = limitBytes * 8 * 0.96;
  const audioBps = Math.max(64_000, Math.round(audioKbps * 1000));
  const audioBits = audioBps * sec;
  const videoBits = Math.max(400_000 * sec, budgetBits - audioBits);
  const videoBps = Math.max(400_000, Math.floor(videoBits / sec));
  return { videoBps, audioBps };
}

/** Mania accuracy contribution — Perfect is 305. */
const MANIA_RESULT_WEIGHT: Record<ReplayJudgmentResult, number> = {
  perfect: 305,
  great: 300,
  good: 200,
  ok: 100,
  meh: 50,
  miss: 0,
};
const MANIA_ACC_SCALE = 305;

/** Standard accuracy contribution — 300/100/50 on a 300 scale. */
const STD_RESULT_WEIGHT: Record<ReplayJudgmentResult, number> = {
  perfect: 300,
  great: 300,
  good: 100,
  ok: 50,
  meh: 50,
  miss: 0,
};
const STD_ACC_SCALE = 300;

const HEADER_H = 88;
const FOOTER_H = 64;
/** Strip under the playfield for combo/accuracy when hudPlacement is `below`. */
const HUD_BELOW_H = 88;
const CONTENT_PAD = 24;

export type ReplayVideoExportProgress = {
  phase: "audio" | "encode" | "finalize" | "done";
  fraction?: number;
};

export type ReplayVideoExportOptions = {
  replay: LoadedScoreReplay;
  /** Mania scroll speed from rewatch prefs. */
  scrollSpeed?: number;
  /** Fullscreen playfield width % (mania, fullscreen only). */
  fieldWidth?: number;
  /** Match fullscreen vs windowed playfield sizing. */
  fullscreen?: boolean;
  /** Explicit skins (falls back to localStorage stores). */
  stdSkin?: StdSkin;
  previewSkin?: PreviewSkin;
  /** Resolution / fps / encode quality preset. */
  presetId?: ReplayVideoExportPresetId;
  /** Solid dark background instead of beatmap cover (smaller files). */
  hideBackground?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: ReplayVideoExportProgress) => void;
  /** Override preset width (advanced). */
  width?: number;
  height?: number;
  fps?: number;
};

type LoadedScoreReplay = ScoreReplay & {
  beatmap: NonNullable<ScoreReplay["beatmap"]>;
  playback: NonNullable<ScoreReplay["playback"]>;
  score: NonNullable<ScoreReplay["score"]>;
  frames: NonNullable<ScoreReplay["frames"]>;
  judgments: NonNullable<ScoreReplay["judgments"]>;
  simulated: NonNullable<ScoreReplay["simulated"]>;
};

export type ReplayVideoExportResult = {
  blob: Blob;
  filename: string;
  mimeType: string;
};

type HudState = {
  combo: number;
  accuracy: number;
  last: ReplayJudgmentResult | null;
};

type PlayfieldRect = { x: number; y: number; w: number; h: number };

function isStdRuleset(shortName: string | null | undefined): boolean {
  const s = (shortName ?? "").toLowerCase();
  return s === "osu" || s === "standard" || s === "std";
}

function isManiaRuleset(shortName: string | null | undefined): boolean {
  return (shortName ?? "").toLowerCase() === "mania";
}

function chartEndMs(replay: LoadedScoreReplay): number {
  let end = replay.beatmap.lengthMs ?? 0;
  for (const n of replay.beatmap.notes ?? []) {
    end = Math.max(end, n.endMs, n.startMs);
  }
  for (const o of replay.beatmap.hitObjects ?? []) {
    if (o.type === "circle") end = Math.max(end, o.timeMs);
    else end = Math.max(end, o.endMs);
  }
  for (const j of replay.judgments ?? []) {
    end = Math.max(end, j.tMs);
  }
  return Math.max(0, end);
}

const TRIM_PAD_START_MS = 800;
const TRIM_PAD_END_MS = 1200;

/**
 * Active chart window for export (optionally trimmed idle lead-in/outro).
 */
export function exportTimeWindow(
  replay: Parameters<typeof chartEndMs>[0],
  trimIdle: boolean,
): { startMs: number; endMs: number } {
  const rawEnd = chartEndMs(replay as LoadedScoreReplay);
  if (!trimIdle) {
    return { startMs: 0, endMs: Math.max(1000, rawEnd) };
  }

  let start = Number.POSITIVE_INFINITY;
  for (const n of replay.beatmap.notes ?? []) {
    start = Math.min(start, n.startMs);
  }
  for (const o of replay.beatmap.hitObjects ?? []) {
    if ("timeMs" in o && typeof o.timeMs === "number") {
      start = Math.min(start, o.timeMs);
    }
  }
  for (const j of replay.judgments ?? []) {
    start = Math.min(start, j.tMs);
  }
  if (!Number.isFinite(start)) start = 0;

  const startMs = Math.max(0, start - TRIM_PAD_START_MS);
  const endMs = Math.max(startMs + 1000, rawEnd + TRIM_PAD_END_MS);
  return { startMs, endMs };
}

/** Exported clip duration (ms), respecting preset trim when provided. */
export function estimateReplayDurationMs(
  replay: Parameters<typeof chartEndMs>[0],
  opts?: { trimIdle?: boolean },
): number {
  const { startMs, endMs } = exportTimeWindow(replay, opts?.trimIdle ?? true);
  return Math.max(0, endMs - startMs);
}

function sanitizeFilenamePart(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function buildReplayVideoFilename(replay: LoadedScoreReplay): string {
  const artist = sanitizeFilenamePart(replay.beatmap.artist || "Unknown");
  const title = sanitizeFilenamePart(replay.beatmap.title || "Beatmap");
  const diff = sanitizeFilenamePart(replay.beatmap.difficultyName || "diff");
  const player = sanitizeFilenamePart(replay.score.userUsername || "player");
  return `${artist} - ${title} [${diff}] (${player}).mp4`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Export cancelled", "AbortError");
  }
}

async function decodeBeatmapAudio(
  audioUrl: string,
  signal?: AbortSignal,
): Promise<AudioBuffer> {
  const res = await fetch(audioUrl, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch beatmap audio (${res.status})`);
  }
  const raw = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(raw.slice(0));
  } finally {
    void ctx.close();
  }
}

function sliceAudioBuffer(
  source: AudioBuffer,
  startSec: number,
  endSec: number,
): AudioBuffer {
  const start = Math.min(source.duration, Math.max(0, startSec));
  const end = Math.min(source.duration, Math.max(start, endSec));
  const startFrame = Math.floor(start * source.sampleRate);
  const endFrame = Math.max(startFrame + 1, Math.floor(end * source.sampleRate));
  const frames = endFrame - startFrame;
  const out = new AudioBuffer({
    length: frames,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });
  for (let c = 0; c < source.numberOfChannels; c += 1) {
    out.copyToChannel(
      source.getChannelData(c).subarray(startFrame, endFrame),
      c,
    );
  }
  return out;
}

async function loadImageFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image decode failed"));
        img.src = objectUrl;
      });
      return img;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

async function loadBackgroundImage(
  replay: LoadedScoreReplay,
  signal?: AbortSignal,
): Promise<HTMLImageElement | null> {
  const url =
    localBeatmapCoverUrl(replay.beatmap.backgroundFileHash) ??
    osuBeatmapCoverUrl(replay.beatmap.setOnlineId, "cover");
  if (!url) return null;
  return loadImageFromUrl(url, signal);
}

async function loadRoxysuLogo(
  signal?: AbortSignal,
): Promise<HTMLImageElement | null> {
  return loadImageFromUrl(roxyIconUrl, signal);
}

function computeHud(
  judgments: Array<{ tMs: number; result: ReplayJudgmentResult }>,
  tMs: number,
  std: boolean,
): HudState {
  const weight = std ? STD_RESULT_WEIGHT : MANIA_RESULT_WEIGHT;
  const scale = std ? STD_ACC_SCALE : MANIA_ACC_SCALE;
  let combo = 0;
  let last: ReplayJudgmentResult | null = null;
  let accWeight = 0;
  let judged = 0;
  for (const j of judgments) {
    if (j.tMs > tMs) break;
    last = j.result;
    if (j.result === "miss") combo = 0;
    else combo += 1;
    accWeight += weight[j.result];
    judged += 1;
  }
  return {
    combo,
    accuracy: judged > 0 ? accWeight / (judged * scale) : 1,
    last,
  };
}

function evenDim(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

function layoutPlayfield(
  canvasW: number,
  canvasH: number,
  std: boolean,
  fieldWidthPct: number,
  fullscreen: boolean,
): PlayfieldRect {
  const contentY = HEADER_H;
  const contentH = canvasH - HEADER_H - FOOTER_H;
  const contentW = canvasW;

  if (std) {
    const availW = contentW - CONTENT_PAD * 2;
    const availH = contentH - CONTENT_PAD * 2;
    const scale = Math.min(availW / 4, availH / 3);
    const w = scale * 4;
    const h = scale * 3;
    return {
      x: (contentW - w) / 2,
      y: contentY + (contentH - h) / 2,
      w,
      h,
    };
  }

  // Mania: fullscreen uses fieldWidth %; windowed matches max-w-3xl (~768–960px).
  const w = fullscreen
    ? Math.min(
        contentW - CONTENT_PAD * 2,
        contentW * (clamp(fieldWidthPct, FIELD_WIDTH_MIN, FIELD_WIDTH_MAX) / 100),
      )
    : Math.min(contentW - CONTENT_PAD * 2, 960);
  const h = contentH - CONTENT_PAD * 2;
  return {
    x: (contentW - w) / 2,
    y: contentY + CONTENT_PAD,
    w,
    h: Math.max(1, h),
  };
}

/**
 * Size the canvas tightly around header + playfield + optional HUD + footer.
 * `maxW`/`maxH` come from the preset as upper bounds.
 */
function layoutTightCanvas(
  std: boolean,
  maxW: number,
  maxH: number,
  fieldWidthPct: number,
  fullscreen: boolean,
  hudBelow: boolean,
): { width: number; height: number; rect: PlayfieldRect } {
  const padX = 20;
  const padY = 12;
  const hudH = hudBelow ? HUD_BELOW_H : 0;
  const chromeH = HEADER_H + FOOTER_H + hudH;

  if (std) {
    const availW = maxW - padX * 2;
    const availH = maxH - chromeH - padY * 2;
    const scale = Math.min(availW / 4, availH / 3);
    const pfW = evenDim(scale * 4);
    const pfH = evenDim(scale * 3);
    const width = evenDim(pfW + padX * 2);
    const height = evenDim(chromeH + pfH + padY * 2);
    return {
      width,
      height,
      rect: { x: (width - pfW) / 2, y: HEADER_H + padY, w: pfW, h: pfH },
    };
  }

  const targetW = fullscreen
    ? Math.min(
        maxW - padX * 2,
        maxW * (clamp(fieldWidthPct, FIELD_WIDTH_MIN, FIELD_WIDTH_MAX) / 100),
      )
    : // Discord-sized presets stay ~720 wide; HQ presets can go wider.
      Math.min(maxW - padX * 2, maxW > 1280 ? 960 : 720);
  const pfW = evenDim(targetW);
  const availH = maxH - chromeH - padY * 2;
  const pfH = evenDim(Math.min(availH, Math.round(pfW * 1.2)));
  const width = evenDim(pfW + padX * 2);
  const height = evenDim(chromeH + pfH + padY * 2);
  return {
    width,
    height,
    rect: { x: (width - pfW) / 2, y: HEADER_H + padY, w: pfW, h: pfH },
  };
}

function drawCoverBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bg: HTMLImageElement | null,
  hideBackground: boolean,
): void {
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, width, height);
  if (!hideBackground && bg && bg.naturalWidth > 0) {
    const scale = Math.max(width / bg.naturalWidth, height / bg.naturalHeight);
    const bw = bg.naturalWidth * scale;
    const bh = bg.naturalHeight * scale;
    ctx.drawImage(bg, (width - bw) / 2, (height - bh) / 2, bw, bh);
  }
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  if (hideBackground) {
    grad.addColorStop(0, "rgba(0,0,0,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0.55)");
  } else {
    grad.addColorStop(0, "rgba(0,0,0,0.70)");
    grad.addColorStop(0.45, "rgba(0,0,0,0.80)");
    grad.addColorStop(1, "rgba(0,0,0,0.92)");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  replay: LoadedScoreReplay,
  width: number,
): void {
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, width, HEADER_H);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H - 0.5);
  ctx.lineTo(width, HEADER_H - 0.5);
  ctx.stroke();

  const title = [
    replay.beatmap.title ?? "Untitled",
    replay.beatmap.difficultyName,
  ]
    .filter(Boolean)
    .join(" · ");

  const subtitleParts = [
    replay.beatmap.artist,
    isStdRuleset(replay.beatmap.rulesetShortName)
      ? `CS ${(replay.beatmap.circleSize ?? 5).toFixed(1)} · AR ${(replay.beatmap.approachRate ?? 5).toFixed(1)}`
      : replay.beatmap.columnCount > 0
        ? `${replay.beatmap.columnCount}K`
        : null,
    replay.score.userUsername,
  ].filter(Boolean) as string[];

  ctx.fillStyle = "#f4f4f5";
  ctx.font = '700 36px Outfit, Figtree, ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, 32, 42, width - 64);

  let x = 32;
  const y = 68;
  ctx.font = '500 18px Figtree, ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = "rgba(161,161,170,1)";
  if (subtitleParts.length > 0) {
    const sub = subtitleParts.join(" · ");
    ctx.fillText(sub, x, y, width * 0.55);
    x += ctx.measureText(sub).width + 12;
  }

  const entries = parseModEntries(replay.score.mods);
  const labels =
    entries.length === 0 ? ["NM"] : entries.map((e) => formatModAcronym(e));
  ctx.font = '700 12px Figtree, ui-sans-serif, system-ui, sans-serif';
  for (const label of labels) {
    const isRate = label.startsWith("X");
    const tw = ctx.measureText(label).width;
    const bw = tw + 14;
    const bh = 22;
    const by = y - 15;
    ctx.fillStyle = isRate ? "rgba(167,139,250,0.25)" : "rgba(255,255,255,0.10)";
    roundRect(ctx, x, by, bw, bh, 6);
    ctx.fill();
    ctx.fillStyle = isRate ? "#c4b5fd" : "rgba(161,161,170,1)";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 7, by + bh / 2);
    x += bw + 6;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  rect: PlayfieldRect,
  hud: HudState,
  placement: ReplayVideoHudPlacement,
): void {
  const boxH = 72;
  const boxW = 140;
  const gap = 12;

  if (placement === "below") {
    const y = rect.y + rect.h + Math.max(8, (HUD_BELOW_H - boxH) / 2);
    const leftX = rect.x;
    const rightX = rect.x + rect.w - boxW;

    // Combo — under playfield, left
    {
      const x = leftX;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(ctx, x, y, boxW, boxH, 10);
      ctx.fill();
      ctx.fillStyle = "rgba(113,113,122,1)";
      ctx.font = '700 11px Figtree, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("COMBO", x + 14, y + 22);
      ctx.fillStyle = "#f4f4f5";
      ctx.font =
        '700 32px Outfit, Figtree, ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(`${hud.combo}`, x + 14, y + 54);
      const comboW = ctx.measureText(`${hud.combo}`).width;
      ctx.fillStyle = "rgba(161,161,170,1)";
      ctx.font =
        '700 16px Outfit, Figtree, ui-sans-serif, system-ui, sans-serif';
      ctx.fillText("x", x + 14 + comboW + 2, y + 54);
    }

    // Accuracy — under playfield, right
    {
      const x = Math.max(leftX + boxW + gap, rightX);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(ctx, x, y, boxW, boxH, 10);
      ctx.fill();
      ctx.fillStyle = "rgba(113,113,122,1)";
      ctx.font = '700 11px Figtree, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("ACCURACY", x + boxW - 14, y + 22);
      ctx.fillStyle = "#f4f4f5";
      ctx.font =
        '700 28px Outfit, Figtree, ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(formatAccuracy(hud.accuracy), x + boxW - 14, y + 52);
      if (hud.last) {
        ctx.fillStyle = JUDGMENT_COLORS[hud.last];
        ctx.font = '700 12px Figtree, ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(hud.last.toUpperCase(), x + boxW - 14, y + 66);
      }
    }
    return;
  }

  const pad = 16;

  // Combo — top left of playfield
  {
    const x = rect.x + pad;
    const y = rect.y + pad;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, x, y, boxW, boxH, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(113,113,122,1)";
    ctx.font = '700 11px Figtree, ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("COMBO", x + 14, y + 22);
    ctx.fillStyle = "#f4f4f5";
    ctx.font = '700 32px Outfit, Figtree, ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${hud.combo}`, x + 14, y + 54);
    const comboW = ctx.measureText(`${hud.combo}`).width;
    ctx.fillStyle = "rgba(161,161,170,1)";
    ctx.font = '700 16px Outfit, Figtree, ui-sans-serif, system-ui, sans-serif';
    ctx.fillText("x", x + 14 + comboW + 2, y + 54);
  }

  // Accuracy — top right of playfield
  {
    const x = rect.x + rect.w - pad - boxW;
    const y = rect.y + pad;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, x, y, boxW, boxH, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(113,113,122,1)";
    ctx.font = '700 11px Figtree, ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("ACCURACY", x + boxW - 14, y + 22);
    ctx.fillStyle = "#f4f4f5";
    ctx.font = '700 28px Outfit, Figtree, ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(formatAccuracy(hud.accuracy), x + boxW - 14, y + 52);
    if (hud.last) {
      ctx.fillStyle = JUDGMENT_COLORS[hud.last];
      ctx.font = '700 12px Figtree, ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(hud.last.toUpperCase(), x + boxW - 14, y + 66);
    }
  }
}

function drawFooterStats(
  ctx: CanvasRenderingContext2D,
  replay: LoadedScoreReplay,
  width: number,
  height: number,
  logo: HTMLImageElement | null,
): void {
  const y0 = height - FOOTER_H;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, y0, width, FOOTER_H);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.beginPath();
  ctx.moveTo(0, y0 + 0.5);
  ctx.lineTo(width, y0 + 0.5);
  ctx.stroke();

  const lineY = y0 + FOOTER_H / 2;

  // Roxysu watermark — bottom left (logo + wordmark).
  let x = 28;
  const logoSize = 28;
  if (logo && logo.naturalWidth > 0) {
    ctx.globalAlpha = 0.9;
    ctx.drawImage(
      logo,
      x,
      lineY - logoSize / 2,
      logoSize,
      logoSize,
    );
    ctx.globalAlpha = 1;
    x += logoSize + 10;
  }
  ctx.font = '700 18px Outfit, Figtree, ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(244,244,245,0.88)";
  ctx.fillText("Roxysu", x, lineY);
  x += ctx.measureText("Roxysu").width + 28;

  // Subtle separator before stats.
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.moveTo(x, lineY - 12);
  ctx.lineTo(x, lineY + 12);
  ctx.stroke();
  x += 28;

  const sim = replay.simulated;
  ctx.font = '500 16px Figtree, ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = "rgba(161,161,170,1)";

  const stored = `Stored ${formatAccuracy(replay.score.accuracy)} · ${replay.score.maxCombo}x`;
  ctx.fillText(stored, x, lineY);
  x += ctx.measureText(stored).width + 28;

  const simText = `Sim ${formatAccuracy(sim.accuracy)} · ${sim.maxCombo}x`;
  ctx.fillText(simText, x, lineY);
  x += ctx.measureText(simText).width + 28;

  const counts: Array<[ReplayJudgmentResult, number]> = [
    ["perfect", sim.counts.perfect],
    ["great", sim.counts.great],
    ["good", sim.counts.good],
    ["ok", sim.counts.ok],
    ["meh", sim.counts.meh],
    ["miss", sim.counts.miss],
  ];
  ctx.font = '600 16px Figtree, ui-sans-serif, system-ui, sans-serif';
  for (let i = 0; i < counts.length; i += 1) {
    const [key, n] = counts[i]!;
    ctx.fillStyle = JUDGMENT_COLORS[key];
    const t = String(n);
    ctx.fillText(t, x, lineY);
    x += ctx.measureText(t).width;
    if (i < counts.length - 1) {
      ctx.fillStyle = "rgba(161,161,170,1)";
      ctx.fillText(" / ", x, lineY);
      x += ctx.measureText(" / ").width;
    }
  }
}

function paintComposedFrame(args: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  replay: LoadedScoreReplay;
  tMs: number;
  std: boolean;
  bg: HTMLImageElement | null;
  logo: HTMLImageElement | null;
  hideBackground: boolean;
  hudPlacement: ReplayVideoHudPlacement;
  playfield: HTMLCanvasElement;
  playfieldCtx: CanvasRenderingContext2D;
  rect: PlayfieldRect;
  stdPaint?: {
    trail: CursorTrailPoint[];
    comboNumbers: number[];
    judgmentMaps: ReturnType<typeof buildHeadMap>;
    skin: StdSkin;
    hidden: boolean;
  };
  maniaPaint?: {
    notes: LoadedScoreReplay["beatmap"]["notes"];
    scrollSpeed: number;
    skin: KeymodeSkin;
    hitPosition: number;
    laneCover: number;
    headJudgments: Map<number, NotefieldJudgment>;
  };
}): void {
  const {
    ctx,
    width,
    height,
    replay,
    tMs,
    std,
    bg,
    logo,
    hideBackground,
    hudPlacement,
    playfield,
    playfieldCtx,
    rect,
  } = args;

  drawCoverBackground(ctx, width, height, bg, hideBackground);
  drawHeader(ctx, replay, width);

  // Paint playfield into its own canvas at the on-screen size.
  if (std && args.stdPaint) {
    paintStdPlayfield({
      ctx: playfieldCtx,
      width: rect.w,
      height: rect.h,
      tMs,
      hitObjects: replay.beatmap.hitObjects ?? [],
      circleSize: replay.beatmap.circleSize,
      approachRate: replay.beatmap.approachRate,
      frames: replay.stdFrames ?? [],
      hidden: args.stdPaint.hidden,
      skin: args.stdPaint.skin,
      trail: args.stdPaint.trail,
      comboNumbers: args.stdPaint.comboNumbers,
      judgmentMaps: args.stdPaint.judgmentMaps,
    });
  } else if (!std && args.maniaPaint) {
    paintManiaNotefield({
      ctx: playfieldCtx,
      width: rect.w,
      height: rect.h,
      tMs,
      columnCount: replay.beatmap.columnCount,
      notes: args.maniaPaint.notes,
      scrollSpeed: args.maniaPaint.scrollSpeed,
      playbackRate: 1,
      skin: args.maniaPaint.skin,
      hitPosition: args.maniaPaint.hitPosition,
      laneCover: args.maniaPaint.laneCover,
      frames: replay.frames,
      judgments: replay.judgments,
      headJudgments: args.maniaPaint.headJudgments,
      highlightMissNotes: false,
    });
  }

  ctx.drawImage(playfield, rect.x, rect.y, rect.w, rect.h);

  const hud = computeHud(
    replay.judgments as Array<{ tMs: number; result: ReplayJudgmentResult }>,
    tMs,
    std,
  );
  drawHud(ctx, rect, hud, hudPlacement);
  drawFooterStats(ctx, replay, width, height, logo);
}

/**
 * Encode a score rewatch as an MP4 blob matching the rewatch page composition.
 */
export async function exportReplayVideo(
  opts: ReplayVideoExportOptions,
): Promise<ReplayVideoExportResult> {
  const {
    replay,
    signal,
    onProgress,
  } = opts;

  const preset = getReplayVideoExportPreset(opts.presetId ?? "1080");
  const fps = opts.fps ?? preset.fps;
  const hideBackground =
    opts.hideBackground ?? preset.hideBackgroundDefault;
  const trimIdle = preset.trimIdle ?? false;
  const tightCrop = preset.tightCrop ?? false;
  const hudPlacement: ReplayVideoHudPlacement =
    preset.hudPlacement ?? "overlay";
  const hudBelow = hudPlacement === "below";

  const ruleset = replay.beatmap.rulesetShortName;
  const std = isStdRuleset(ruleset);
  const mania = isManiaRuleset(ruleset);
  if (!std && !mania) {
    throw new Error("Replay video export supports mania and standard only");
  }

  const audioUrl = localBeatmapAudioUrl(replay.beatmap.audioFileHash);
  if (!audioUrl) {
    throw new Error("No beatmap audio available for this score");
  }

  onProgress?.({ phase: "audio" });
  throwIfAborted(signal);

  const [fullAudio, bg, logo] = await Promise.all([
    decodeBeatmapAudio(audioUrl, signal),
    hideBackground ? Promise.resolve(null) : loadBackgroundImage(replay, signal),
    loadRoxysuLogo(signal),
  ]);

  const { startMs, endMs } = exportTimeWindow(replay, trimIdle);
  const clipEndMs = Math.min(
    endMs,
    Math.max(startMs + 1000, fullAudio.duration * 1000),
  );
  const durationSec = Math.max(0.5, (clipEndMs - startMs) / 1000);
  const audio = sliceAudioBuffer(
    fullAudio,
    startMs / 1000,
    clipEndMs / 1000,
  );

  const fieldWidth = opts.fieldWidth ?? FIELD_WIDTH_DEFAULT;
  const fullscreen = opts.fullscreen ?? false;

  let width: number;
  let height: number;
  let rect: PlayfieldRect;
  if (tightCrop) {
    const tight = layoutTightCanvas(
      std,
      opts.width ?? preset.width,
      opts.height ?? preset.height,
      fieldWidth,
      fullscreen,
      hudBelow,
    );
    width = tight.width;
    height = tight.height;
    rect = tight.rect;
  } else {
    width = opts.width ?? preset.width;
    height = opts.height ?? preset.height;
    rect = layoutPlayfield(width, height, std, fieldWidth, fullscreen);
  }

  const encodeQuality = preset.fitUnderBytes
    ? (() => {
        const { videoBps } = computeFitBitrates(
          durationSec,
          preset.fitUnderBytes,
          preset.estimateAudioKbps,
        );
        // Constant bitrate so we actually spend the Discord size budget
        // (VBR undershoots hard on solid-background playfield footage).
        return new Quality({ bitrate: videoBps, bitrateMode: "constant" });
      })()
    : qualityFromLevel(preset.quality);
  const audioEncodeQuality = preset.fitUnderBytes
    ? (() => {
        const { audioBps } = computeFitBitrates(
          durationSec,
          preset.fitUnderBytes,
          preset.estimateAudioKbps,
        );
        return new Quality({ bitrate: audioBps, bitrateMode: "constant" });
      })()
    : qualityFromLevel(preset.quality);

  const mp4 = new Mp4OutputFormat();
  const videoCodec = await getFirstEncodableVideoCodec(
    mp4.getSupportedVideoCodecs(),
    { width, height },
  );
  const audioCodec = await getFirstEncodableAudioCodec(
    mp4.getSupportedAudioCodecs(),
  );
  if (!videoCodec || !audioCodec) {
    throw new Error(
      "This browser cannot encode MP4 video/audio (WebCodecs required)",
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not create canvas context");

  const playfield = document.createElement("canvas");
  playfield.width = Math.max(1, Math.round(rect.w));
  playfield.height = Math.max(1, Math.round(rect.h));
  const playfieldCtx = playfield.getContext("2d", { alpha: false });
  if (!playfieldCtx) throw new Error("Could not create playfield context");

  const target = new BufferTarget();
  const output = new Output({ format: mp4, target });

  const videoSource = new CanvasSource(canvas, {
    codec: videoCodec,
    quality: encodeQuality,
  });
  const audioSource = new AudioBufferSource({
    codec: audioCodec,
    quality: audioEncodeQuality,
  });

  output.addVideoTrack(videoSource, { frameRate: fps });
  output.addAudioTrack(audioSource);
  output.setMetadataTags({
    title: `${replay.beatmap.artist} - ${replay.beatmap.title}`,
    artist: replay.beatmap.artist ?? undefined,
  });

  await output.start();
  throwIfAborted(signal);
  await audioSource.add(audio);
  throwIfAborted(signal);
  onProgress?.({ phase: "encode", fraction: 0 });

  const frameDuration = 1 / fps;
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));

  const stdPaint = std
    ? {
        trail: [] as CursorTrailPoint[],
        comboNumbers: buildComboNumbers(replay.beatmap.hitObjects ?? []),
        judgmentMaps: buildHeadMap(
          replay.judgments as StdPlayfieldJudgment[],
        ),
        skin: opts.stdSkin ?? getStdSkin(),
        hidden: replay.playback.acronyms.includes("HD"),
      }
    : undefined;

  const maniaPaint = !std
    ? (() => {
        const previewSkin = opts.previewSkin ?? getPreviewSkin();
        const list = replay.beatmap.notes ?? [];
        let notes = list;
        if (list.length > 1) {
          let sorted = true;
          for (let i = 1; i < list.length; i += 1) {
            if (list[i]!.startMs < list[i - 1]!.startMs) {
              sorted = false;
              break;
            }
          }
          if (!sorted) notes = [...list].sort((a, b) => a.startMs - b.startMs);
        }
        return {
          notes,
          scrollSpeed: clampScrollSpeed(
            opts.scrollSpeed ?? PREVIEW_SCROLL_DEFAULT,
          ),
          skin: resolveKeymodeSkin(previewSkin, replay.beatmap.columnCount),
          hitPosition: clamp(
            previewSkin.hitPosition,
            HIT_POSITION_MIN,
            HIT_POSITION_MAX,
          ),
          laneCover: clamp(
            previewSkin.laneCover,
            LANE_COVER_MIN,
            LANE_COVER_MAX,
          ),
          headJudgments: buildHeadJudgmentMap(replay.judgments),
        };
      })()
    : undefined;

  for (let i = 0; i < totalFrames; i += 1) {
    throwIfAborted(signal);
    const tSec = i * frameDuration;
    const tMs = startMs + tSec * 1000;
    paintComposedFrame({
      ctx,
      width,
      height,
      replay,
      tMs,
      std,
      bg,
      logo,
      hideBackground,
      hudPlacement,
      playfield,
      playfieldCtx,
      rect,
      stdPaint,
      maniaPaint,
    });
    await videoSource.add(tSec, frameDuration);
    if (i % 15 === 0 || i === totalFrames - 1) {
      onProgress?.({ phase: "encode", fraction: (i + 1) / totalFrames });
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  onProgress?.({ phase: "finalize" });
  throwIfAborted(signal);
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) throw new Error("Encoder produced an empty file");

  const mimeType = mp4.mimeType;
  const blob = new Blob([buffer], { type: mimeType });
  onProgress?.({ phase: "done", fraction: 1 });

  return {
    blob,
    filename: buildReplayVideoFilename(replay),
    mimeType,
  };
}

/** Trigger a browser download for the exported blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
