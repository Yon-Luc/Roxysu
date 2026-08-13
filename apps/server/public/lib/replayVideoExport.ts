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
  signal?: AbortSignal;
  onProgress?: (p: ReplayVideoExportProgress) => void;
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

function sliceAudioBuffer(source: AudioBuffer, endSec: number): AudioBuffer {
  const end = Math.min(source.duration, Math.max(0, endSec));
  const frames = Math.max(1, Math.floor(end * source.sampleRate));
  const out = new AudioBuffer({
    length: frames,
    numberOfChannels: source.numberOfChannels,
    sampleRate: source.sampleRate,
  });
  for (let c = 0; c < source.numberOfChannels; c += 1) {
    out.copyToChannel(source.getChannelData(c).subarray(0, frames), c);
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

function drawCoverBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bg: HTMLImageElement | null,
): void {
  ctx.fillStyle = "#0a0a0c";
  ctx.fillRect(0, 0, width, height);
  if (bg && bg.naturalWidth > 0) {
    const scale = Math.max(width / bg.naturalWidth, height / bg.naturalHeight);
    const bw = bg.naturalWidth * scale;
    const bh = bg.naturalHeight * scale;
    ctx.drawImage(bg, (width - bw) / 2, (height - bh) / 2, bw, bh);
  }
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "rgba(0,0,0,0.70)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.80)");
  grad.addColorStop(1, "rgba(0,0,0,0.92)");
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
): void {
  const pad = 16;
  const boxH = 72;
  const boxW = 140;

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
    playfield,
    playfieldCtx,
    rect,
  } = args;

  drawCoverBackground(ctx, width, height, bg);
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
  drawHud(ctx, rect, hud);
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
    width = REPLAY_VIDEO_WIDTH,
    height = REPLAY_VIDEO_HEIGHT,
    fps = REPLAY_VIDEO_FPS,
  } = opts;

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
    loadBackgroundImage(replay, signal),
    loadRoxysuLogo(signal),
  ]);
  const endMs = Math.max(chartEndMs(replay), fullAudio.duration * 1000);
  const durationSec = endMs / 1000;
  const audio = sliceAudioBuffer(fullAudio, durationSec);

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

  const fieldWidth = opts.fieldWidth ?? FIELD_WIDTH_DEFAULT;
  const fullscreen = opts.fullscreen ?? false;
  const rect = layoutPlayfield(width, height, std, fieldWidth, fullscreen);

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
    quality: QUALITY_HIGH,
  });
  const audioSource = new AudioBufferSource({
    codec: audioCodec,
    quality: QUALITY_HIGH,
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
    const tMs = tSec * 1000;
    paintComposedFrame({
      ctx,
      width,
      height,
      replay,
      tMs,
      std,
      bg,
      logo,
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
