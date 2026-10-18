import type { BeatmapPreview } from "./api";
import type { ReplayJudgmentResult } from "./paintManiaNotefield";
import {
  comboColorAtIndex,
  resolveComboPalette,
  type StdSkin,
} from "./stdSkin";

export type PaintContext2D =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

const OSU_WIDTH = 512;
const OSU_HEIGHT = 384;
/** osu!stable follow-point spacing in playfield pixels. */
const FOLLOW_POINT_SPACING = 32;
const FOLLOW_POINT_PADDING = 16;

export type StdHitObject = NonNullable<BeatmapPreview["hitObjects"]>[number];

export type StdPlayfieldFrame = {
  tMs: number;
  x: number;
  y: number;
  buttons: number;
};

export type StdPlayfieldJudgment = {
  noteIndex: number;
  tMs: number;
  result: ReplayJudgmentResult;
  errorMs?: number | null;
  kind?: "head" | "tick" | "tail";
  frac?: number;
};

export type CursorTrailPoint = { x: number; y: number; t: number };

/** Optional legacy skin sprites (Phase B). Missing fields fall back to procedural. */
export type StdPlayfieldSprites = {
  hitcircle?: CanvasImageSource | null;
  hitcircleoverlay?: CanvasImageSource | null;
  approachcircle?: CanvasImageSource | null;
  cursor?: CanvasImageSource | null;
  cursortrail?: CanvasImageSource | null;
  reversearrow?: CanvasImageSource | null;
  sliderfollowcircle?: CanvasImageSource | null;
  sliderball?: CanvasImageSource | null;
  sliderballFrames?: CanvasImageSource[];
  followpoint?: CanvasImageSource | null;
  followpointFrames?: CanvasImageSource[];
  defaults?: Array<CanvasImageSource | null | undefined>;
  hit300?: CanvasImageSource | null;
  hit100?: CanvasImageSource | null;
  hit50?: CanvasImageSource | null;
  hit0?: CanvasImageSource | null;
};

export type ComboInfo = {
  /** 1-based combo number drawn on the object (0 for spinners). */
  numbers: number[];
  /** 0-based colour index into the effective palette. */
  colourIndexes: number[];
};

const JUDGMENT_COLORS: Record<ReplayJudgmentResult, string> = {
  perfect: "#ffe566",
  great: "#7dd3fc",
  good: "#86efac",
  ok: "#fdba74",
  meh: "#f9a8d4",
  miss: "#f87171",
};

const POPUP_LABEL: Record<ReplayJudgmentResult, string> = {
  perfect: "300",
  great: "300",
  good: "100",
  ok: "50",
  meh: "50",
  miss: "X",
};

const POPUP_COLOR: Record<ReplayJudgmentResult, string> = {
  perfect: "#ffffff",
  great: "#ffffff",
  good: "#66ccff",
  ok: "#ff9966",
  meh: "#ff9966",
  miss: "#ff6666",
};

const POPUP_SPRITE_KEY: Partial<
  Record<ReplayJudgmentResult, keyof StdPlayfieldSprites>
> = {
  perfect: "hit300",
  great: "hit300",
  good: "hit100",
  ok: "hit50",
  meh: "hit50",
  miss: "hit0",
};

function approachPreemptMs(ar: number): number {
  if (ar < 5) return 1800 - 120 * ar;
  return 1200 - 150 * (ar - 5);
}

function approachFadeInMs(ar: number): number {
  if (ar < 5) return 1200 - 120 * ar;
  return 800 - 100 * (ar - 5);
}

function circleRadius(cs: number): number {
  return 54.4 - 4.48 * cs;
}

function bisectLeft(objects: StdHitObject[], timeMs: number): number {
  let lo = 0;
  let hi = objects.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (objects[mid]!.timeMs < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bisectFrame(frames: StdPlayfieldFrame[], timeMs: number): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.tMs <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

function objectEndMs(obj: StdHitObject): number {
  if (obj.type === "circle") return obj.timeMs;
  return obj.endMs;
}

/**
 * Build combo numbers and colour indexes matching osu!stable:
 * first object and objects after spinners force a new combo; colour index
 * starts at -1 and advances by `1 + comboOffset` on each new combo.
 */
export function buildComboInfo(objects: StdHitObject[]): ComboInfo {
  const numbers = new Array<number>(objects.length).fill(0);
  const colourIndexes = new Array<number>(objects.length).fill(0);
  let combo = 0;
  let colourIndex = -1;
  let forceNewCombo = true;

  for (let i = 0; i < objects.length; i += 1) {
    const obj = objects[i]!;
    if (obj.type === "spinner") {
      forceNewCombo = true;
      continue;
    }
    const isNew = forceNewCombo || obj.newCombo === true;
    const offset = obj.comboOffset ?? 0;
    if (isNew) {
      colourIndex += 1 + offset;
      combo = 1;
    } else {
      combo += 1;
    }
    forceNewCombo = false;
    numbers[i] = combo;
    colourIndexes[i] = colourIndex;
  }
  return { numbers, colourIndexes };
}

/** @deprecated Prefer `buildComboInfo`. */
export function buildComboNumbers(objects: StdHitObject[]): number[] {
  return buildComboInfo(objects).numbers;
}

export function pathPointAt(
  path: Array<{ x: number; y: number }>,
  frac: number,
): { x: number; y: number } | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0]!;
  const f = Math.min(1, Math.max(0, frac)) * (path.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(path.length - 1, i0 + 1);
  const u = f - i0;
  const a = path[i0]!;
  const b = path[i1]!;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

export function pathTangentAt(
  path: Array<{ x: number; y: number }>,
  frac: number,
): { x: number; y: number } {
  if (path.length < 2) return { x: 1, y: 0 };
  const f = Math.min(1, Math.max(0, frac)) * (path.length - 1);
  const i0 = Math.max(0, Math.min(path.length - 2, Math.floor(f)));
  const a = path[i0]!;
  const b = path[i0 + 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export function bounceFracAt(u: number, repeats: number): number {
  const prog = Math.min(repeats, Math.max(0, u * repeats));
  const seg = Math.floor(prog);
  let local = prog - seg;
  if (seg % 2 === 1) local = 1 - local;
  return Math.min(1, Math.max(0, local));
}

/** Final resting position of an object (slider ends after all slides). */
export function objectEndPos(obj: StdHitObject): { x: number; y: number } {
  if (obj.type === "circle") return { x: obj.stackX, y: obj.stackY };
  if (obj.type === "spinner") return { x: OSU_WIDTH / 2, y: OSU_HEIGHT / 2 };
  const endFrac = obj.repeats % 2 === 1 ? 1 : 0;
  return pathPointAt(obj.path, endFrac) ?? { x: obj.stackX, y: obj.stackY };
}

/**
 * Follow-point positions between two objects (osu!spacing). Empty when too close.
 */
export function followPointPositions(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const usable = dist - FOLLOW_POINT_PADDING * 2;
  if (usable < FOLLOW_POINT_SPACING) return [];
  const count = Math.floor(usable / FOLLOW_POINT_SPACING);
  if (count <= 0) return [];
  const ux = dx / dist;
  const uy = dy / dist;
  const start = FOLLOW_POINT_PADDING;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const d = start + (i + 0.5) * (usable / count);
    out.push({ x: from.x + ux * d, y: from.y + uy * d });
  }
  return out;
}

/** Path length fraction revealed during snake-in (0…1). Completes at hit time. */
export function snakeFracAt(
  t: number,
  timeMs: number,
  preempt: number,
): number {
  if (t >= timeMs) return 1;
  const appear = timeMs - preempt;
  if (t <= appear) return 0;
  return Math.min(1, Math.max(0, (t - appear) / preempt));
}

export function buildHeadMap(judgments: StdPlayfieldJudgment[] | undefined): {
  head: Map<number, StdPlayfieldJudgment>;
  subs: Map<number, StdPlayfieldJudgment[]>;
} {
  const head = new Map<number, StdPlayfieldJudgment>();
  const subs = new Map<number, StdPlayfieldJudgment[]>();
  if (!judgments) return { head, subs };
  for (const j of judgments) {
    if (j.kind && j.kind !== "head") {
      const list = subs.get(j.noteIndex) ?? [];
      list.push(j);
      subs.set(j.noteIndex, list);
    } else if (!head.has(j.noteIndex)) {
      head.set(j.noteIndex, j);
    }
  }
  for (const list of subs.values()) {
    list.sort((a, b) => a.tMs - b.tMs);
  }
  return { head, subs };
}

function interpolateCursor(
  frames: StdPlayfieldFrame[],
  t: number,
): { x: number; y: number; buttons: number } | null {
  if (frames.length === 0) return null;
  const idx = bisectFrame(frames, t);
  if (idx < 0) return { x: frames[0]!.x, y: frames[0]!.y, buttons: 0 };
  const a = frames[idx]!;
  const b = frames[idx + 1];
  if (!b || b.tMs === a.tMs) {
    return { x: a.x, y: a.y, buttons: a.buttons };
  }
  const u = Math.min(1, Math.max(0, (t - a.tMs) / (b.tMs - a.tMs)));
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    buttons: a.buttons,
  };
}

function subListFor(
  subs: Map<number, StdPlayfieldJudgment[]>,
  index: number,
  kind: "tick" | "tail",
): StdPlayfieldJudgment | undefined {
  return (subs.get(index) ?? []).find((s) => s.kind === kind);
}

function playfieldTransform(w: number, h: number) {
  const scale = Math.min(w / OSU_WIDTH, h / OSU_HEIGHT);
  const ox = (w - OSU_WIDTH * scale) / 2;
  const oy = (h - OSU_HEIGHT * scale) / 2;
  return { scale, ox, oy };
}

/** Scratch canvas reused for multiplicative combo tint (osu AccentColour). */
let tintScratch: OffscreenCanvas | HTMLCanvasElement | null = null;
let tintScratchCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null =
  null;

function getTintScratch(
  width: number,
  height: number,
): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  if (!tintScratch || !tintScratchCtx) {
    if (typeof OffscreenCanvas !== "undefined") {
      tintScratch = new OffscreenCanvas(w, h);
      tintScratchCtx = tintScratch.getContext("2d");
    } else if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      tintScratch = c;
      tintScratchCtx = c.getContext("2d");
    }
  } else if (tintScratch.width !== w || tintScratch.height !== h) {
    tintScratch.width = w;
    tintScratch.height = h;
  }
  if (!tintScratch || !tintScratchCtx) {
    throw new Error("tint scratch unavailable");
  }
  return { canvas: tintScratch, ctx: tintScratchCtx };
}

/**
 * Draw a sprite with multiplicative combo tint (osu!stable/lazer AccentColour).
 * Untinted when `tint` is null.
 */
function drawTintedImage(
  ctx: PaintContext2D,
  img: CanvasImageSource,
  cx: number,
  cy: number,
  size: number,
  tint: string | null,
  alpha: number,
): void {
  const w =
    "width" in img && typeof img.width === "number" ? img.width : size;
  const h =
    "height" in img && typeof img.height === "number" ? img.height : size;
  const dw = size;
  const dh = size * (h / Math.max(1, w));

  if (!tint) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return;
  }

  try {
    const { canvas, ctx: sctx } = getTintScratch(dw, dh);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, canvas.width, canvas.height);
    sctx.globalCompositeOperation = "source-over";
    sctx.globalAlpha = 1;
    sctx.drawImage(img, 0, 0, dw, dh);
    sctx.globalCompositeOperation = "source-in";
    sctx.fillStyle = tint;
    sctx.fillRect(0, 0, dw, dh);
    sctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(canvas, 0, 0, dw, dh, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  } catch {
    // Fallback: draw untinted if scratch unavailable (e.g. some workers).
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
}

/** Angle (radians) for a followpoint facing right along from→to. */
export function followPointAngle(
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Darken a hex colour for slider body fill when using combo colour. */
export function darkenHex(hex: string, factor = 0.35): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = Number.parseInt(m[1]!, 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function drawSpriteCentered(
  ctx: PaintContext2D,
  img: CanvasImageSource,
  cx: number,
  cy: number,
  size: number,
  alpha: number,
  rotation = 0,
): void {
  const w =
    "width" in img && typeof img.width === "number" ? img.width : size;
  const h =
    "height" in img && typeof img.height === "number" ? img.height : size;
  const dw = size;
  const dh = size * (h / Math.max(1, w));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

function drawComboDigits(
  ctx: PaintContext2D,
  combo: number,
  sx: number,
  sy: number,
  digitH: number,
  sprites: StdPlayfieldSprites | null | undefined,
  alpha: number,
): void {
  const text = String(combo);
  const defaults = sprites?.defaults;
  if (defaults && defaults.some(Boolean)) {
    const digits = text.split("").map((ch) => defaults[Number(ch)] ?? null);
    if (digits.every(Boolean)) {
      const widths = digits.map((img) => {
        const w =
          img && "width" in img && typeof img.width === "number"
            ? img.width
            : digitH;
        const h =
          img && "height" in img && typeof img.height === "number"
            ? img.height
            : digitH;
        return digitH * (w / Math.max(1, h));
      });
      const total = widths.reduce((a, b) => a + b, 0);
      let x = sx - total / 2;
      for (let i = 0; i < digits.length; i += 1) {
        const img = digits[i]!;
        const dw = widths[i]!;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, x, sy - digitH / 2, dw, digitH);
        ctx.restore();
        x += dw;
      }
      return;
    }
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.max(10, digitH)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, sx, sy + digitH * 0.05);
  ctx.globalAlpha = 1;
}

function drawReverseChevron(
  ctx: PaintContext2D,
  sx: number,
  sy: number,
  size: number,
  angle: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = size * 0.45;
  ctx.beginPath();
  ctx.moveTo(-s * 0.2, -s);
  ctx.lineTo(s * 0.55, 0);
  ctx.lineTo(-s * 0.2, s);
  ctx.stroke();
  ctx.restore();
}

function strokePathUpTo(
  ctx: PaintContext2D,
  path: Array<{ x: number; y: number }>,
  endFrac: number,
  toScreen: (x: number, y: number) => { sx: number; sy: number },
): void {
  if (path.length === 0 || endFrac <= 0) return;
  const maxIdx = (path.length - 1) * Math.min(1, endFrac);
  const lastFull = Math.floor(maxIdx);
  ctx.beginPath();
  for (let p = 0; p <= lastFull; p += 1) {
    const pt = path[p]!;
    const sp = toScreen(pt.x, pt.y);
    if (p === 0) ctx.moveTo(sp.sx, sp.sy);
    else ctx.lineTo(sp.sx, sp.sy);
  }
  if (lastFull < path.length - 1) {
    const a = path[lastFull]!;
    const b = path[lastFull + 1]!;
    const u = maxIdx - lastFull;
    const sp = toScreen(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
    if (lastFull === 0 && endFrac > 0) {
      // moveTo already at start
    }
    ctx.lineTo(sp.sx, sp.sy);
  }
}

export type PaintStdPlayfieldArgs = {
  ctx: PaintContext2D;
  /** CSS-pixel width of the drawing surface (after any DPR transform). */
  width: number;
  /** CSS-pixel height of the drawing surface. */
  height: number;
  tMs: number;
  hitObjects: StdHitObject[];
  circleSize: number;
  approachRate: number;
  frames?: StdPlayfieldFrame[];
  judgments?: StdPlayfieldJudgment[];
  hidden?: boolean;
  skin?: StdSkin | null;
  /** Beatmap `[Colours]` ComboN palette when present. */
  beatmapComboColors?: string[] | null;
  /** Optional imported legacy skin sprites. */
  sprites?: StdPlayfieldSprites | null;
  /**
   * Mutable cursor trail. When provided, advanced for this frame (sequential
   * encode). When omitted, trail is rebuilt from frames for the last 180ms.
   */
  trail?: CursorTrailPoint[];
  /** Precomputed combo info; built if omitted. */
  comboInfo?: ComboInfo;
  /** @deprecated Prefer `comboInfo`. */
  comboNumbers?: number[];
  /** Precomputed head/sub judgment maps; built if omitted. */
  judgmentMaps?: ReturnType<typeof buildHeadMap>;
};

/** Paint one standard playfield frame at `tMs`. */
export function paintStdPlayfield(args: PaintStdPlayfieldArgs): void {
  const {
    ctx,
    width: w,
    height: h,
    tMs: t,
    hitObjects: objs,
    circleSize: cs,
    approachRate: ar,
    frames = [],
    judgments,
    hidden = false,
    skin = null,
    beatmapComboColors = null,
    sprites = null,
  } = args;

  const preempt = approachPreemptMs(ar);
  const fadeIn = approachFadeInMs(ar);
  const { scale, ox, oy } = playfieldTransform(w, h);
  const { head, subs } = args.judgmentMaps ?? buildHeadMap(judgments);
  const combo =
    args.comboInfo ??
    (args.comboNumbers
      ? {
          numbers: args.comboNumbers,
          colourIndexes: args.comboNumbers.map((n) => Math.max(0, n - 1)),
        }
      : buildComboInfo(objs));
  const palette = resolveComboPalette(
    skin?.comboColors,
    beatmapComboColors ?? undefined,
  );
  const radius =
    circleRadius(cs) * (skin?.hitCircleScale != null ? skin.hitCircleScale : 1);
  const defaultApproach = "#ffffff";
  const approachOverride =
    skin?.approach && skin.approach.toLowerCase() !== defaultApproach
      ? skin.approach
      : null;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(ox, oy, OSU_WIDTH * scale, OSU_HEIGHT * scale);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    ox + 0.5,
    oy + 0.5,
    OSU_WIDTH * scale - 1,
    OSU_HEIGHT * scale - 1,
  );

  const toScreen = (x: number, y: number) => ({
    sx: ox + x * scale,
    sy: oy + y * scale,
  });
  const colorFor = (i: number) =>
    comboColorAtIndex(palette, combo.colourIndexes[i] ?? 0);

  const startIdx = Math.max(0, bisectLeft(objs, t - 2000) - 2);
  const visible: Array<{ obj: StdHitObject; index: number }> = [];
  for (let i = startIdx; i < objs.length; i += 1) {
    const obj = objs[i]!;
    if (obj.timeMs - preempt > t + 50) break;
    const end = objectEndMs(obj);
    const judgment = head.get(i);
    const linger = Math.max(200, preempt * 0.15);
    const hideAfter =
      obj.type === "slider" || obj.type === "spinner"
        ? end + linger
        : judgment != null
          ? judgment.tMs + (judgment.result === "miss" ? 200 : 120)
          : end + linger;
    if (t > hideAfter) continue;
    visible.push({ obj, index: i });
  }

  const alphaFor = (obj: StdHitObject, index: number) => {
    const judgment = head.get(index);
    const alphaFromApproach = (() => {
      const appear = obj.timeMs - preempt;
      if (t < appear) return 0;
      if (t < appear + fadeIn) return (t - appear) / fadeIn;
      return 1;
    })();
    const hiddenAlpha = (() => {
      if (!hidden || obj.type === "spinner") return 1;
      const disappearStart = obj.timeMs - preempt * 0.6;
      if (t <= disappearStart) return 1;
      const u = (t - disappearStart) / (preempt * 0.4);
      return Math.max(0, 1 - u);
    })();
    void judgment;
    return Math.min(1, alphaFromApproach) * hiddenAlpha;
  };

  const hasSliderTrackOverride = Boolean(
    skin?.imported?.colours?.sliderTrackOverride,
  );

  // Pass 1: slider bodies (+ ticks) under everything else.
  for (const { obj, index } of visible) {
    if (obj.type !== "slider" || obj.path.length < 2) continue;
    const baseAlpha = alphaFor(obj, index);
    if (baseAlpha <= 0) continue;
    const r = radius * scale;
    const fillColor = colorFor(index);
    const trackColor = skin?.sliderTrack ?? "rgba(165, 180, 252, 0.85)";
    // No SliderTrackOverride → body uses combo colour (osu default).
    const fill = hasSliderTrackOverride
      ? (skin?.sliderFill ?? darkenHex(fillColor))
      : skin?.imported
        ? darkenHex(fillColor)
        : (skin?.sliderFill ?? "rgba(30, 30, 40, 0.9)");
    const snake = snakeFracAt(t, obj.timeMs, preempt);
    // Body diameter ≈ circle diameter (2r); thin border outside.
    const bodyWidth = r * 2;
    const borderWidth = bodyWidth * 1.12;

    ctx.globalAlpha = Math.min(0.95, baseAlpha);
    ctx.strokeStyle = trackColor;
    ctx.lineWidth = borderWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokePathUpTo(ctx, obj.path, snake, toScreen);
    ctx.stroke();
    ctx.strokeStyle = fill;
    ctx.lineWidth = bodyWidth;
    strokePathUpTo(ctx, obj.path, snake, toScreen);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (skin?.showSliderTicks !== false) {
      const subList = subs.get(index) ?? [];
      for (const tick of obj.ticks ?? []) {
        if (tick.frac > snake + 1e-3) continue;
        const pt = pathPointAt(obj.path, tick.frac);
        if (!pt) continue;
        const sp = toScreen(pt.x, pt.y);
        const tickJ = subList.find(
          (s) =>
            s.kind === "tick" &&
            s.frac != null &&
            Math.abs(s.frac - tick.frac) < 1e-4,
        );
        let color = "rgba(255,255,255,0.5)";
        if (tickJ && t >= tickJ.tMs) {
          color =
            tickJ.result === "miss" ? "rgba(248,113,113,0.8)" : fillColor;
        }
        ctx.fillStyle = color;
        ctx.globalAlpha = baseAlpha;
        ctx.beginPath();
        ctx.arc(sp.sx, sp.sy, Math.max(2, r * 0.2), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Pass 2: follow points above bodies.
  for (const { obj, index } of visible) {
    if (obj.type === "spinner") continue;
    let prevIdx = index - 1;
    while (prevIdx >= 0 && objs[prevIdx]!.type === "spinner") prevIdx -= 1;
    if (prevIdx < 0) continue;
    const prev = objs[prevIdx]!;
    if (prev.type === "spinner") continue;
    if (obj.newCombo === true) continue;
    if ((combo.colourIndexes[index] ?? 0) !== (combo.colourIndexes[prevIdx] ?? 0)) {
      continue;
    }
    if ((combo.numbers[index] ?? 0) !== (combo.numbers[prevIdx] ?? 0) + 1) {
      continue;
    }

    const from = objectEndPos(prev);
    const to = { x: obj.stackX, y: obj.stackY };
    const points = followPointPositions(from, to);
    if (points.length === 0) continue;

    const appear = obj.timeMs - preempt;
    const fadeEnd = obj.timeMs;
    if (t < appear || t > fadeEnd) continue;
    const fpAlpha =
      t < appear + fadeIn
        ? (t - appear) / fadeIn
        : t > fadeEnd - fadeIn * 0.5
          ? Math.max(0, (fadeEnd - t) / (fadeIn * 0.5))
          : 1;
    const fillColor = colorFor(index);
    const r = radius * scale;
    const angle = followPointAngle(from, to);
    const fpFrames = sprites?.followpointFrames;
    const fpImg =
      fpFrames && fpFrames.length > 0
        ? fpFrames[Math.floor(t / 50) % fpFrames.length]!
        : sprites?.followpoint;

    for (const pt of points) {
      const sp = toScreen(pt.x, pt.y);
      if (fpImg) {
        drawSpriteCentered(
          ctx,
          fpImg,
          sp.sx,
          sp.sy,
          r * 0.5,
          fpAlpha * 0.9,
          angle,
        );
      } else {
        ctx.globalAlpha = fpAlpha * 0.75;
        ctx.fillStyle = fillColor;
        ctx.beginPath();
        ctx.arc(sp.sx, sp.sy, Math.max(1.5, r * 0.12), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Pass 3: spinners, approaches, heads (circle → numbers → overlay), reverse, ball, popups.
  for (const { obj, index } of visible) {
    const judgment = head.get(index);
    const judged = judgment != null && t >= judgment.tMs - 1;
    const baseAlpha = alphaFor(obj, index);

    if (obj.type === "spinner") {
      const duration = Math.max(1, obj.endMs - obj.timeMs);
      const progress = Math.min(1, Math.max(0, (t - obj.timeMs) / duration));
      const { sx, sy } = toScreen(OSU_WIDTH / 2, OSU_HEIGHT / 2);
      const r = Math.min(OSU_WIDTH, OSU_HEIGHT) * 0.35 * scale;
      const spinnerColor = skin?.spinner ?? "#fbbf24";
      const remain = Math.max(0, 1 - progress);
      const outerR = r * (1 + 0.85 * remain);
      ctx.globalAlpha = Math.min(1, baseAlpha);
      ctx.strokeStyle = approachOverride ?? spinnerColor;
      ctx.lineWidth = 2.5 * scale;
      ctx.beginPath();
      ctx.arc(sx, sy, outerR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = judged
        ? JUDGMENT_COLORS[judgment!.result]
        : spinnerColor;
      ctx.lineWidth = 4 * scale;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = spinnerColor;
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }

    const hx = obj.stackX;
    const hy = obj.stackY;
    const { sx, sy } = toScreen(hx, hy);
    const r = radius * scale;
    const fillColor = colorFor(index);
    const isSlider = obj.type === "slider";

    // Approach circle.
    if (!judged && t < obj.timeMs) {
      const remain = (obj.timeMs - t) / preempt;
      const approachR = r * (1 + 3 * Math.max(0, remain));
      const approachColor = approachOverride ?? fillColor;
      const approachAlpha = Math.min(0.9, baseAlpha);
      if (sprites?.approachcircle) {
        drawTintedImage(
          ctx,
          sprites.approachcircle,
          sx,
          sy,
          approachR * 2,
          approachColor,
          approachAlpha,
        );
      } else {
        ctx.globalAlpha = approachAlpha;
        ctx.strokeStyle = approachColor;
        ctx.lineWidth = 2.5 * scale;
        ctx.beginPath();
        ctx.arc(sx, sy, approachR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Hit circle / slider head: circle → numbers → overlay (stable default).
    const headAlpha = judged
      ? Math.max(0, 1 - (t - (judgment?.tMs ?? t)) / 150)
      : Math.min(1, baseAlpha);
    if (headAlpha > 0 && (!judged || (judgment && t < judgment.tMs + 150))) {
      const headColor =
        judged && judgment ? JUDGMENT_COLORS[judgment.result] : fillColor;
      if (sprites?.hitcircle) {
        drawTintedImage(
          ctx,
          sprites.hitcircle,
          sx,
          sy,
          r * 2,
          headColor,
          headAlpha,
        );
      } else {
        ctx.globalAlpha = headAlpha;
        ctx.fillStyle = headColor;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2 * scale;
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 4 * scale;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.72, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (skin?.showComboNumbers !== false && !judged) {
        const n = combo.numbers[index] ?? 0;
        if (n > 0) {
          drawComboDigits(ctx, n, sx, sy, r * 0.8, sprites, headAlpha);
        }
      }

      if (sprites?.hitcircleoverlay) {
        drawSpriteCentered(
          ctx,
          sprites.hitcircleoverlay,
          sx,
          sy,
          r * 2,
          headAlpha,
        );
      }
    }

    // Reverse arrows above heads.
    if (isSlider && obj.repeats > 1 && t <= obj.endMs) {
      let showFrac = 1;
      let remainingReverses = obj.repeats - 1;
      if (t >= obj.timeMs) {
        const spanDur = Math.max(1, (obj.endMs - obj.timeMs) / obj.repeats);
        const span = Math.min(
          obj.repeats - 1,
          Math.floor((t - obj.timeMs) / spanDur),
        );
        remainingReverses = obj.repeats - 1 - span;
        showFrac = span % 2 === 0 ? 1 : 0;
      }
      if (remainingReverses > 0) {
        const tip = pathPointAt(obj.path, showFrac);
        if (tip) {
          const tp = toScreen(tip.x, tip.y);
          const tangent = pathTangentAt(obj.path, showFrac);
          const angle =
            Math.atan2(tangent.y, tangent.x) +
            (showFrac === 1 ? 0 : Math.PI);
          const revAlpha = Math.min(1, baseAlpha);
          if (sprites?.reversearrow) {
            drawSpriteCentered(
              ctx,
              sprites.reversearrow,
              tp.sx,
              tp.sy,
              r * 1.6,
              revAlpha,
              angle,
            );
          } else {
            drawReverseChevron(
              ctx,
              tp.sx,
              tp.sy,
              r * 1.4,
              angle,
              "#ffffff",
              revAlpha,
            );
          }
        }
      }
    }

    // Slider ball + follow circle.
    if (isSlider && t >= obj.timeMs && t <= obj.endMs) {
      const totalSpan = Math.max(1, obj.endMs - obj.timeMs);
      const uFrac = (t - obj.timeMs) / totalSpan;
      const ballFrac = bounceFracAt(uFrac, Math.max(1, obj.repeats));
      const ball = pathPointAt(obj.path, ballFrac);
      if (ball) {
        const bp = toScreen(ball.x, ball.y);
        const ballAlpha = Math.min(1, baseAlpha);

        if (
          skin?.showFollowCircle !== false &&
          (judged || t >= obj.timeMs)
        ) {
          const followR = r * 2.2;
          if (sprites?.sliderfollowcircle) {
            drawSpriteCentered(
              ctx,
              sprites.sliderfollowcircle,
              bp.sx,
              bp.sy,
              followR * 2,
              ballAlpha * 0.85,
            );
          } else {
            ctx.fillStyle = fillColor;
            ctx.globalAlpha = 0.08 * ballAlpha;
            ctx.beginPath();
            ctx.arc(bp.sx, bp.sy, followR, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.25 * ballAlpha;
            ctx.strokeStyle = fillColor;
            ctx.lineWidth = 2 * scale;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        const ballFrames = sprites?.sliderballFrames;
        const ballImg =
          ballFrames && ballFrames.length > 0
            ? ballFrames[Math.floor(t / 50) % ballFrames.length]!
            : sprites?.sliderball;
        if (ballImg) {
          drawSpriteCentered(ctx, ballImg, bp.sx, bp.sy, r * 2, ballAlpha);
        } else {
          ctx.fillStyle = skin?.sliderBall ?? "#fbbf24";
          ctx.globalAlpha = ballAlpha;
          ctx.beginPath();
          ctx.arc(bp.sx, bp.sy, r * 0.85, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    if (judged && isSlider) {
      const tailJ = subListFor(subs, index, "tail");
      if (tailJ && t >= tailJ.tMs && t <= tailJ.tMs + 150) {
        const tailPoint = pathPointAt(
          obj.path,
          obj.repeats % 2 === 1 ? 1 : 0,
        );
        if (tailPoint) {
          const tp = toScreen(tailPoint.x, tailPoint.y);
          ctx.globalAlpha = Math.max(0, 1 - (t - tailJ.tMs) / 150);
          ctx.fillStyle = JUDGMENT_COLORS[tailJ.result];
          ctx.beginPath();
          ctx.arc(tp.sx, tp.sy, r * 0.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    if (skin?.showHitPopups !== false && judgment) {
      const age = t - judgment.tMs;
      if (age >= 0 && age < 400) {
        const rise = (age / 400) * 34;
        const popAlpha = Math.max(0, 1 - age / 400);
        const key = POPUP_SPRITE_KEY[judgment.result];
        const imgRaw = key ? sprites?.[key] : null;
        const img =
          imgRaw && !Array.isArray(imgRaw) ? (imgRaw as CanvasImageSource) : null;
        if (img) {
          drawSpriteCentered(
            ctx,
            img,
            sx,
            sy - rise - r * 0.4,
            r * 1.8,
            popAlpha,
          );
        } else {
          ctx.globalAlpha = popAlpha;
          ctx.fillStyle = POPUP_COLOR[judgment.result];
          ctx.font = `bold ${Math.max(12, r * 0.9)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(POPUP_LABEL[judgment.result], sx, sy - rise - r * 0.4);
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  const cursor = interpolateCursor(frames, t);
  if (cursor) {
    let trail = args.trail;
    if (trail) {
      trail.push({ x: cursor.x, y: cursor.y, t });
      while (trail.length > 0 && t - trail[0]!.t > 180) trail.shift();
      if (trail.length > 40) trail.splice(0, trail.length - 40);
    } else {
      trail = rebuildTrail(frames, t);
    }

    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = skin?.trail ?? "rgba(255,255,255,0.25)";
    ctx.beginPath();
    for (let i = 0; i < trail.length; i += 1) {
      const p = toScreen(trail[i]!.x, trail[i]!.y);
      if (i === 0) ctx.moveTo(p.sx, p.sy);
      else ctx.lineTo(p.sx, p.sy);
    }
    ctx.stroke();

    if (sprites?.cursortrail && trail.length > 1) {
      for (let i = 0; i < trail.length; i += 1) {
        const p = toScreen(trail[i]!.x, trail[i]!.y);
        const a = ((i + 1) / trail.length) * 0.35;
        drawSpriteCentered(ctx, sprites.cursortrail, p.sx, p.sy, 10 * scale, a);
      }
    }

    const cp = toScreen(cursor.x, cursor.y);
    const clicking =
      (cursor.buttons & 1) !== 0 || (cursor.buttons & 2) !== 0;
    if (sprites?.cursor) {
      drawSpriteCentered(
        ctx,
        sprites.cursor,
        cp.sx,
        cp.sy,
        (clicking ? 28 : 24) * scale,
        1,
      );
    } else {
      ctx.fillStyle = clicking
        ? "rgba(251, 191, 36, 0.95)"
        : (skin?.cursor ?? "rgba(255,255,255,0.9)");
      ctx.beginPath();
      ctx.arc(cp.sx, cp.sy, 6 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();
    }
  }
}

function rebuildTrail(
  frames: StdPlayfieldFrame[],
  t: number,
): CursorTrailPoint[] {
  const out: CursorTrailPoint[] = [];
  const start = t - 180;
  for (const f of frames) {
    if (f.tMs < start) continue;
    if (f.tMs > t) break;
    out.push({ x: f.x, y: f.y, t: f.tMs });
  }
  const cursor = interpolateCursor(frames, t);
  if (cursor && (out.length === 0 || out[out.length - 1]!.t < t - 0.5)) {
    out.push({ x: cursor.x, y: cursor.y, t });
  }
  if (out.length > 40) return out.slice(out.length - 40);
  return out;
}
