import type { ReplayJudgmentResult } from "./paintManiaNotefield";
import {
  catchComboColorAtIndex,
  defaultCatchSkin,
  resolveCatchComboPalette,
  type CatchSkin,
} from "./catchSkin";

export type PaintContext2D =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

const OSU_WIDTH = 512;
const OSU_HEIGHT = 384;
const CATCHER_Y = 344;

export type CatchHitObject =
  | {
      type: "fruit";
      x: number;
      timeMs: number;
      hyperDash: boolean;
      newCombo?: boolean;
      comboOffset?: number;
      indexInBeatmap?: number;
    }
  | {
      type: "droplet";
      x: number;
      timeMs: number;
      kind: "large" | "tiny";
    }
  | {
      type: "banana";
      x: number;
      timeMs: number;
    };

export type CatchPlayfieldFrame = {
  tMs: number;
  x: number;
  dashing: boolean;
};

export type CatchPlayfieldJudgment = {
  noteIndex: number;
  tMs: number;
  result: ReplayJudgmentResult;
  errorMs?: number | null;
  kind?: "fruit" | "droplet" | "banana";
};

export type CatcherTrailPoint = {
  x: number;
  t: number;
  dashing?: boolean;
  /** Dash ghost, or the single rising copy spawned when a hyperdash starts. */
  kind?: "dash" | "afterimage";
  facing?: 1 | -1;
};

export type CatchFruitKind = "pear" | "grapes" | "apple" | "orange";

export const CATCH_FRUIT_KINDS: CatchFruitKind[] = [
  "pear",
  "grapes",
  "apple",
  "orange",
];

export function fruitKindForIndex(indexInBeatmap: number): CatchFruitKind {
  return CATCH_FRUIT_KINDS[
    ((indexInBeatmap % 4) + 4) % 4
  ]!;
}

export type CatchPlayfieldSprites = {
  pear?: CanvasImageSource | null;
  pearOverlay?: CanvasImageSource | null;
  grapes?: CanvasImageSource | null;
  grapesOverlay?: CanvasImageSource | null;
  apple?: CanvasImageSource | null;
  appleOverlay?: CanvasImageSource | null;
  orange?: CanvasImageSource | null;
  orangeOverlay?: CanvasImageSource | null;
  drop?: CanvasImageSource | null;
  dropOverlay?: CanvasImageSource | null;
  bananas?: CanvasImageSource | null;
  bananasOverlay?: CanvasImageSource | null;
  catcherIdle?: CanvasImageSource | null;
  catcherFail?: CanvasImageSource | null;
  catcherKiai?: CanvasImageSource | null;
  lighting?: CanvasImageSource | null;
};

export type CatchComboInfo = {
  numbers: number[];
  colourIndexes: number[];
};

const POPUP_LABEL: Record<ReplayJudgmentResult, string> = {
  perfect: "300",
  great: "300",
  good: "100",
  ok: "100",
  meh: "100",
  miss: "X",
};

const POPUP_COLOR: Record<ReplayJudgmentResult, string> = {
  perfect: "#ffffff",
  great: "#ffffff",
  good: "#66ccff",
  ok: "#66ccff",
  meh: "#facc15",
  miss: "#ff6666",
};

function approachPreemptMs(ar: number): number {
  if (ar < 5) return 1800 - 120 * ar;
  return 1200 - 150 * (ar - 5);
}

function catcherWidth(cs: number): number {
  return 106.75 * Math.abs(1 - (0.7 * (cs - 5)) / 5);
}

/** Lazer `CalculateScaleFromCircleSize`. At CS 5 this is 0.5. */
export function circleSizeScale(cs: number): number {
  return Math.abs(1 - (0.7 * (cs - 5)) / 5) / 2;
}

/** Fruit diameter in osu! pixels. 128 × circle-size scale (64 at CS 5). */
export function fruitDiameter(cs: number): number {
  return 128 * circleSizeScale(cs);
}

/** Droplet diameter in osu! pixels. Tiny droplets are half of that. */
export function dropletDiameter(cs: number, tiny = false): number {
  const d = 32 * circleSizeScale(cs);
  return tiny ? d / 2 : d;
}

const FRUIT_DRAW_SPACE = 128;
const FRUIT_RADIUS_ADJUST = 1.1;
const LARGE_PULP_3 = (16 * FRUIT_RADIUS_ADJUST) / FRUIT_DRAW_SPACE;
const SMALL_PULP = LARGE_PULP_3 / 2;
const LARGE_PULP_4 = LARGE_PULP_3 * 0.925;
const PULP_DIST_3 = 0.15;
const PULP_DIST_4 = PULP_DIST_3 / 0.925;
const WHITE_BORDER = (6 * FRUIT_RADIUS_ADJUST) / FRUIT_DRAW_SPACE;
const HYPER_BORDER = (12 * FRUIT_RADIUS_ADJUST) / FRUIT_DRAW_SPACE;
const DASH_TRAIL_MS = 800;
const AFTERIMAGE_MS = 1200;
const TRAIL_INTERVAL_MS = 16;

type PulpSpec = { x: number; y: number; w: number; h: number };

function pulpAt(angleDeg: number, distance: number, size: number): PulpSpec {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: distance * Math.sin(rad),
    y: distance * Math.cos(rad),
    w: size,
    h: size,
  };
}

function pulpsForKind(kind: CatchFruitKind): PulpSpec[] {
  switch (kind) {
    case "pear":
      return [
        { x: 0, y: -0.33, w: SMALL_PULP, h: SMALL_PULP },
        pulpAt(60, PULP_DIST_3, LARGE_PULP_3),
        pulpAt(180, PULP_DIST_3, LARGE_PULP_3),
        pulpAt(300, PULP_DIST_3, LARGE_PULP_3),
      ];
    case "grapes":
      return [
        { x: 0, y: -0.25, w: SMALL_PULP, h: SMALL_PULP },
        pulpAt(0, PULP_DIST_3, LARGE_PULP_3),
        pulpAt(120, PULP_DIST_3, LARGE_PULP_3),
        pulpAt(240, PULP_DIST_3, LARGE_PULP_3),
      ];
    case "apple":
      return [
        { x: 0, y: -0.3, w: SMALL_PULP, h: SMALL_PULP },
        pulpAt(45, PULP_DIST_4, LARGE_PULP_4),
        pulpAt(135, PULP_DIST_4, LARGE_PULP_4),
        pulpAt(225, PULP_DIST_4, LARGE_PULP_4),
        pulpAt(315, PULP_DIST_4, LARGE_PULP_4),
      ];
    case "orange":
      return [
        { x: 0, y: -0.34, w: SMALL_PULP, h: SMALL_PULP },
        pulpAt(0, PULP_DIST_4, LARGE_PULP_4),
        pulpAt(90, PULP_DIST_4, LARGE_PULP_4),
        pulpAt(180, PULP_DIST_4, LARGE_PULP_4),
        pulpAt(270, PULP_DIST_4, LARGE_PULP_4),
      ];
  }
}

const BANANA_PULPS: PulpSpec[] = [
  { x: 0, y: -0.3, w: SMALL_PULP, h: SMALL_PULP },
  { x: 0, y: 0.05, w: LARGE_PULP_4 * 0.8, h: LARGE_PULP_4 * 2.5 },
];

function unitHash(n: number): number {
  const x = Math.imul(n | 0, 1103515245) + 12345;
  return ((x >>> 0) % 10000) / 10000;
}

/** About ±20°, stable for a given hit time. */
function fruitRotation(timeMs: number): number {
  return (unitHash(Math.floor(timeMs)) - 0.5) * ((40 * Math.PI) / 180);
}

function dropletRotation(timeMs: number, t: number, preempt: number): number {
  const start =
    unitHash(Math.floor(timeMs) ^ 0x9e3779b9) * ((20 * Math.PI) / 180);
  const progress = (t - (timeMs - preempt)) / (preempt + 2000);
  return start + ((720 * Math.PI) / 180) * progress;
}

function spriteNaturalSize(
  img: CanvasImageSource | null | undefined,
): { w: number; h: number } | null {
  if (!img) return null;
  if (img instanceof HTMLImageElement) {
    if (img.naturalWidth <= 0) return null;
    return { w: img.naturalWidth, h: img.naturalHeight };
  }
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
    return img.width > 0 ? { w: img.width, h: img.height } : null;
  }
  if (img instanceof HTMLCanvasElement || img instanceof OffscreenCanvas) {
    return img.width > 0 ? { w: img.width, h: img.height } : null;
  }
  return null;
}

function playfieldTransform(w: number, h: number) {
  const scale = Math.min(w / OSU_WIDTH, h / OSU_HEIGHT);
  const ox = (w - OSU_WIDTH * scale) / 2;
  const oy = (h - OSU_HEIGHT * scale) / 2;
  return { scale, ox, oy };
}

function toScreen(
  tf: ReturnType<typeof playfieldTransform>,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: tf.ox + x * tf.scale, y: tf.oy + y * tf.scale };
}

function autoCatchFrames(objects: CatchHitObject[]): CatchPlayfieldFrame[] {
  const frames: CatchPlayfieldFrame[] = [];
  for (const obj of objects) {
    if (obj.type === "fruit") {
      frames.push({ tMs: obj.timeMs, x: obj.x, dashing: obj.hyperDash });
    } else if (obj.type === "droplet" && obj.kind === "large") {
      frames.push({ tMs: obj.timeMs, x: obj.x, dashing: false });
    }
  }
  return frames;
}

function interpolateCatcher(
  frames: CatchPlayfieldFrame[],
  t: number,
): { x: number; dashing: boolean; facing: 1 | -1 } | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.tMs <= t) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo - 1;
  if (idx < 0) return { x: frames[0]!.x, dashing: false, facing: 1 };
  const a = frames[idx]!;
  const b = frames[idx + 1];
  if (!b || b.tMs === a.tMs) {
    return { x: a.x, dashing: a.dashing, facing: 1 };
  }
  const u = Math.min(1, Math.max(0, (t - a.tMs) / (b.tMs - a.tMs)));
  const x = a.x + (b.x - a.x) * u;
  const facing: 1 | -1 = b.x >= a.x ? 1 : -1;
  return { x, dashing: a.dashing, facing };
}

/**
 * Combo numbers + colour indexes for fruits (Standard-style newCombo /
 * comboOffset). Droplets/bananas keep colourIndexes at 0.
 */
export function buildCatchComboInfo(objects: CatchHitObject[]): CatchComboInfo {
  const numbers = new Array<number>(objects.length).fill(0);
  const colourIndexes = new Array<number>(objects.length).fill(0);
  let combo = 0;
  let colourIndex = -1;
  let forceNewCombo = true;

  for (let i = 0; i < objects.length; i += 1) {
    const obj = objects[i]!;
    if (obj.type !== "fruit") continue;
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

/** @deprecated Prefer `buildCatchComboInfo`. */
export function buildCatchComboNumbers(objects: CatchHitObject[]): number[] {
  return buildCatchComboInfo(objects).numbers;
}

export function buildCatchJudgmentMap(
  judgments: CatchPlayfieldJudgment[] | undefined,
): Map<number, CatchPlayfieldJudgment> {
  const map = new Map<number, CatchPlayfieldJudgment>();
  if (!judgments) return map;
  for (const j of judgments) {
    if (!map.has(j.noteIndex)) map.set(j.noteIndex, j);
  }
  return map;
}

let tintScratch: {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} | null = null;

function getTintScratch(
  w: number,
  h: number,
): {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
} | null {
  const cw = Math.ceil(w);
  const ch = Math.ceil(h);
  if (cw <= 0 || ch <= 0) return null;
  if (
    !tintScratch ||
    tintScratch.canvas.width < cw ||
    tintScratch.canvas.height < ch
  ) {
    try {
      if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(cw, ch);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        tintScratch = { canvas, ctx };
      } else if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        tintScratch = { canvas, ctx };
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }
  return tintScratch;
}

function drawTintedImage(
  ctx: PaintContext2D,
  img: CanvasImageSource,
  cx: number,
  cy: number,
  size: number,
  tint: string | null,
  alpha: number,
): boolean {
  const dims = spriteNaturalSize(img);
  if (!dims) return false;
  const aspect = dims.h / dims.w;
  const dw = size;
  const dh = size * aspect;
  const x = cx - dw / 2;
  const y = cy - dh / 2;

  if (!tint) {
    ctx.save();
    ctx.globalAlpha = alpha;
    try {
      ctx.drawImage(img, x, y, dw, dh);
    } catch {
      ctx.restore();
      return false;
    }
    ctx.restore();
    return true;
  }

  const scratch = getTintScratch(dw, dh);
  if (!scratch) {
    ctx.save();
    ctx.globalAlpha = alpha;
    try {
      ctx.drawImage(img, x, y, dw, dh);
    } catch {
      ctx.restore();
      return false;
    }
    ctx.restore();
    return true;
  }

  try {
    const { canvas, ctx: sctx } = scratch;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = "source-over";
    sctx.globalAlpha = 1;
    sctx.clearRect(0, 0, canvas.width, canvas.height);
    sctx.drawImage(img, 0, 0, dw, dh);
    sctx.globalCompositeOperation = "multiply";
    sctx.fillStyle = tint;
    sctx.fillRect(0, 0, dw, dh);
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(img, 0, 0, dw, dh);
    sctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(canvas, 0, 0, dw, dh, x, y, dw, dh);
    ctx.restore();
    return true;
  } catch {
    return false;
  }
}

function drawAdditiveImage(
  ctx: PaintContext2D,
  img: CanvasImageSource,
  cx: number,
  cy: number,
  size: number,
  tint: string,
  alpha: number,
): boolean {
  const dims = spriteNaturalSize(img);
  if (!dims) return false;
  const dw = size;
  const dh = size * (dims.h / dims.w);
  const x = cx - dw / 2;
  const y = cy - dh / 2;
  const scratch = getTintScratch(dw, dh);
  if (!scratch) return false;
  try {
    const { canvas, ctx: sctx } = scratch;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = "source-over";
    sctx.globalAlpha = 1;
    sctx.clearRect(0, 0, canvas.width, canvas.height);
    sctx.fillStyle = tint;
    sctx.fillRect(0, 0, dw, dh);
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(img, 0, 0, dw, dh);
    sctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha;
    ctx.drawImage(canvas, 0, 0, dw, dh, x, y, dw, dh);
    ctx.restore();
    return true;
  } catch {
    return false;
  }
}

function drawSpriteCentered(
  ctx: PaintContext2D,
  img: CanvasImageSource,
  cx: number,
  cy: number,
  size: number,
  alpha: number,
): boolean {
  return drawTintedImage(ctx, img, cx, cy, size, null, alpha);
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function fruitSpritesFor(
  sprites: CatchPlayfieldSprites | null | undefined,
  kind: CatchFruitKind,
): { base?: CanvasImageSource | null; overlay?: CanvasImageSource | null } {
  if (!sprites) return {};
  switch (kind) {
    case "pear":
      return { base: sprites.pear, overlay: sprites.pearOverlay };
    case "grapes":
      return { base: sprites.grapes, overlay: sprites.grapesOverlay };
    case "apple":
      return { base: sprites.apple, overlay: sprites.appleOverlay };
    case "orange":
      return { base: sprites.orange, overlay: sprites.orangeOverlay };
  }
}

function drawProceduralPlate(
  ctx: PaintContext2D,
  plate: { x: number; y: number },
  plateW: number,
  scale: number,
  facing: 1 | -1,
  dashing: boolean,
  skin: CatchSkin,
): void {
  const half = (plateW * scale) / 2;
  const plateH = 10 * scale;
  const bodyH = 28 * scale;
  const bodyW = 18 * scale;

  if (dashing) {
    ctx.fillStyle = hexToRgba(skin.hyperDash, 0.32);
    ctx.beginPath();
    ctx.ellipse(
      plate.x,
      plate.y - bodyH * 0.35,
      half * 1.15,
      bodyH * 0.7,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // Plate (catch surface)
  ctx.fillStyle = skin.catcher;
  ctx.beginPath();
  const px = plate.x - half;
  const py = plate.y - plateH * 0.35;
  const r = plateH * 0.45;
  ctx.moveTo(px + r, py);
  ctx.lineTo(px + half * 2 - r, py);
  ctx.quadraticCurveTo(px + half * 2, py, px + half * 2, py + r);
  ctx.lineTo(px + half * 2, py + plateH - r);
  ctx.quadraticCurveTo(
    px + half * 2,
    py + plateH,
    px + half * 2 - r,
    py + plateH,
  );
  ctx.lineTo(px + r, py + plateH);
  ctx.quadraticCurveTo(px, py + plateH, px, py + plateH - r);
  ctx.lineTo(px, py + r);
  ctx.quadraticCurveTo(px, py, px + r, py);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();

  // Body under plate (faces right by default; flip via facing)
  ctx.save();
  ctx.translate(plate.x, plate.y);
  ctx.scale(facing, 1);
  ctx.fillStyle = hexToRgba(skin.catcher, 0.85);
  const bx = -bodyW * 0.35;
  const by = -bodyH;
  const bw = bodyW * 0.7;
  const bh = bodyH * 0.85;
  ctx.fillRect(bx, by, bw, bh);
  // Head
  ctx.beginPath();
  ctx.arc(0, -bodyH * 0.95, 7 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCatcherSprite(
  ctx: PaintContext2D,
  img: CanvasImageSource,
  plate: { x: number; y: number },
  plateW: number,
  scale: number,
  facing: 1 | -1,
  dashing: boolean,
  skin: CatchSkin,
  tint?: string | null,
  alpha = 1,
): boolean {
  const dims = spriteNaturalSize(img);
  if (!dims) return false;
  const plateWFrac = 0.9;
  const spriteW = (plateW * scale) / plateWFrac;
  const spriteH = spriteW * (dims.h / dims.w);
  // Legacy catcher: first ~16px transparent at top; origin near top of plate
  const spriteY = plate.y - 16 * scale;

  if (dashing && !tint) {
    ctx.fillStyle = hexToRgba(skin.hyperDash, 0.28);
    ctx.beginPath();
    ctx.ellipse(
      plate.x,
      spriteY + spriteH * 0.45,
      spriteW * 0.55,
      spriteH * 0.5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  ctx.save();
  ctx.translate(plate.x, spriteY + spriteH / 2);
  ctx.scale(facing, 1);
  if (tint) {
    const drew = drawAdditiveImage(ctx, img, 0, 0, spriteW, tint, alpha);
    ctx.restore();
    return drew;
  }
  ctx.globalAlpha = alpha;
  try {
    ctx.drawImage(img, -spriteW / 2, -spriteH / 2, spriteW, spriteH);
  } catch {
    ctx.restore();
    return false;
  }
  ctx.restore();
  return true;
}

export type PaintCatchPlayfieldArgs = {
  ctx: PaintContext2D;
  width: number;
  height: number;
  tMs: number;
  hitObjects: CatchHitObject[];
  circleSize: number;
  approachRate: number;
  frames?: CatchPlayfieldFrame[];
  judgments?: CatchPlayfieldJudgment[];
  hidden?: boolean;
  skin?: CatchSkin | null;
  trail?: CatcherTrailPoint[];
  comboInfo?: CatchComboInfo;
  /** @deprecated Prefer comboInfo */
  comboNumbers?: number[];
  judgmentMap?: Map<number, CatchPlayfieldJudgment>;
  beatmapComboColors?: string[] | null;
  sprites?: CatchPlayfieldSprites | null;
};

function drawPulps(
  ctx: PaintContext2D,
  pulps: PulpSpec[],
  diameter: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  for (const p of pulps) {
    ctx.beginPath();
    ctx.ellipse(
      p.x * diameter,
      p.y * diameter,
      (p.w * diameter) / 2,
      (p.h * diameter) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawWhiteRing(
  ctx: PaintContext2D,
  diameter: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1, WHITE_BORDER * diameter);
  ctx.beginPath();
  ctx.arc(0, 0, diameter / 2 - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHyperBorder(
  ctx: PaintContext2D,
  diameter: number,
  colour: string,
  alpha: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(1.5, HYPER_BORDER * diameter);
  ctx.globalAlpha = alpha * 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, diameter / 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.3;
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.restore();
}

export function paintCatchPlayfield(args: PaintCatchPlayfieldArgs): void {
  try {
    paintCatchPlayfieldInner(args);
  } catch {
    paintCatchPlayfieldInner({ ...args, sprites: null });
  }
}

function paintCatchPlayfieldInner(args: PaintCatchPlayfieldArgs): void {
  const {
    ctx,
    width: w,
    height: h,
    tMs: t,
    hitObjects: objs,
    circleSize: cs,
    approachRate: ar,
    frames: framesArg = [],
    hidden = false,
    skin: skinArg,
    trail,
    sprites,
  } = args;
  const skin = skinArg ?? defaultCatchSkin();
  const comboInfo =
    args.comboInfo ??
    (args.comboNumbers
      ? {
          numbers: args.comboNumbers,
          colourIndexes: args.comboNumbers.map((n) => Math.max(0, n - 1)),
        }
      : buildCatchComboInfo(objs));
  const judgmentMap = args.judgmentMap ?? buildCatchJudgmentMap(args.judgments);
  const tf = playfieldTransform(w, h);
  const preempt = approachPreemptMs(ar);
  const plateW = catcherWidth(cs) * skin.catcherScale;
  const palette = resolveCatchComboPalette(
    skin.comboColors,
    args.beatmapComboColors ?? undefined,
    { preferSkin: Boolean(skin.imported) },
  );

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c0c12";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#14141c";
  ctx.fillRect(tf.ox, tf.oy, OSU_WIDTH * tf.scale, OSU_HEIGHT * tf.scale);

  const frames = framesArg.length > 0 ? framesArg : autoCatchFrames(objs);
  const catcher = interpolateCatcher(frames, t);
  const catcherX = catcher?.x ?? OSU_WIDTH / 2;
  const facing = catcher?.facing ?? 1;
  const dashing = catcher?.dashing ?? false;

  const ghostSprite = sprites?.catcherIdle || sprites?.catcherKiai || null;

  function comboColourAt(index: number): string {
    return catchComboColorAtIndex(palette, comboInfo.colourIndexes[index] ?? 0);
  }

  function dropletColour(index: number): string {
    for (let j = index; j >= 0; j -= 1) {
      if (objs[j]?.type === "fruit") return comboColourAt(j);
    }
    return skin.droplet;
  }

  function stampCatcher(
    xOsu: number,
    yOsu: number,
    alpha: number,
    tint: string | null,
    sizeScale: number,
    ghostFacing: 1 | -1,
  ): void {
    if (alpha <= 0.02) return;
    const pos = toScreen(tf, xOsu, yOsu);
    const w = plateW * sizeScale;
    ctx.save();
    if (tint) ctx.globalCompositeOperation = "lighter";
    let drew = false;
    if (ghostSprite) {
      drew = drawCatcherSprite(
        ctx,
        ghostSprite,
        pos,
        w,
        tf.scale,
        ghostFacing,
        false,
        skin,
        tint,
        alpha,
      );
    }
    if (!drew) {
      ctx.globalAlpha = alpha;
      drawProceduralPlate(
        ctx,
        pos,
        w,
        tf.scale,
        ghostFacing,
        false,
        tint ? { ...skin, catcher: tint } : skin,
      );
    }
    ctx.restore();
  }

  if (trail && catcher) {
    const last = trail[trail.length - 1];
    if (last && t < last.t - 1) trail.length = 0;
    const prev = trail[trail.length - 1];
    if (dashing && skin.showTrail) {
      if (!prev?.dashing) {
        trail.push({
          x: catcher.x,
          t,
          dashing: true,
          kind: "afterimage",
          facing,
        });
      }
      const lastStamp = trail[trail.length - 1];
      if (
        !lastStamp ||
        lastStamp.kind === "afterimage" ||
        t - lastStamp.t >= TRAIL_INTERVAL_MS
      ) {
        trail.push({
          x: catcher.x,
          t,
          dashing: true,
          kind: "dash",
          facing,
        });
      }
    } else if (prev?.dashing) {
      trail.push({ x: catcher.x, t, dashing: false, facing });
    }
    while (trail.length > 0 && t - trail[0]!.t > AFTERIMAGE_MS) trail.shift();
  }

  if (skin.showTrail && trail) {
    for (const p of trail) {
      if (!p.dashing) continue;
      const age = t - p.t;
      const ghostFacing = p.facing ?? facing;
      if (p.kind === "afterimage") {
        if (age < 0 || age > AFTERIMAGE_MS) continue;
        const u = age / AFTERIMAGE_MS;
        stampCatcher(
          p.x,
          CATCHER_Y - 10 * u,
          (1 - u) * 0.9,
          skin.hyperDashAfterImage || skin.hyperDash,
          0.95 + 0.25 * u,
          ghostFacing,
        );
      } else {
        if (age < 0 || age > DASH_TRAIL_MS) continue;
        const u = age / DASH_TRAIL_MS;
        stampCatcher(
          p.x,
          CATCHER_Y,
          0.4 * (1 - u),
          skin.hyperDash,
          1,
          ghostFacing,
        );
      }
    }
  }

  const fruitD = fruitDiameter(cs);

  // Falling objects
  for (let i = 0; i < objs.length; i += 1) {
    const obj = objs[i]!;
    const judged = judgmentMap.get(i);
    if (judged && judged.tMs <= t && judged.result !== "miss") continue;
    const dt = obj.timeMs - t;
    if (dt > preempt || dt < -80) continue;

    const u = 1 - dt / preempt;
    const y = u * CATCHER_Y;
    let alpha = 1;
    if (hidden && dt > 0) {
      const fadeStart = preempt * 0.4;
      if (dt < fadeStart) alpha = Math.max(0, dt / fadeStart);
    }
    if (alpha <= 0) continue;

    const pos = toScreen(tf, obj.x, y);
    const rot = fruitRotation(obj.timeMs);

    if (obj.type === "banana") {
      const size = fruitD * tf.scale;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(rot);
      const drawn =
        sprites?.bananas &&
        drawSpriteCentered(ctx, sprites.bananas, 0, 0, size, alpha);
      if (drawn && sprites?.bananasOverlay) {
        drawSpriteCentered(ctx, sprites.bananasOverlay, 0, 0, size, alpha);
      }
      if (!drawn) {
        ctx.globalAlpha = alpha;
        drawPulps(ctx, BANANA_PULPS, size, skin.banana);
        drawWhiteRing(ctx, size, alpha * Math.min(1, Math.max(0, dt / 500)));
      }
      ctx.restore();
    } else if (obj.type === "droplet") {
      const size = dropletDiameter(cs, obj.kind === "tiny") * tf.scale;
      const colour = dropletColour(i);
      const spin = dropletRotation(obj.timeMs, t, preempt);
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(spin);
      const drawn =
        sprites?.drop &&
        drawTintedImage(ctx, sprites.drop, 0, 0, size, colour, alpha);
      if (drawn && sprites?.dropOverlay) {
        drawSpriteCentered(ctx, sprites.dropOverlay, 0, 0, size, alpha);
      }
      if (!drawn) {
        const r = size / 2;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-r * 0.22, -r * 0.22, r * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fill();
      }
      ctx.restore();
    } else {
      const comboColor = comboColourAt(i);
      const kind = fruitKindForIndex(obj.indexInBeatmap ?? i);
      const { base, overlay } = fruitSpritesFor(sprites, kind);
      const size = fruitD * tf.scale;
      const hyperColour = skin.hyperDashFruit || skin.hyperDash;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(rot);
      let drawn = false;
      if (base) {
        if (obj.hyperDash) {
          drawAdditiveImage(ctx, base, 0, 0, size * 1.1, hyperColour, alpha);
        }
        drawn = drawTintedImage(ctx, base, 0, 0, size, comboColor, alpha);
        if (drawn && overlay) {
          drawSpriteCentered(ctx, overlay, 0, 0, size, alpha);
        }
      }
      if (!drawn) {
        ctx.globalAlpha = alpha;
        drawPulps(ctx, pulpsForKind(kind), size, comboColor);
        const borderAlpha = Math.min(1, Math.max(0, dt / 500));
        drawWhiteRing(ctx, size, alpha * borderAlpha);
        if (obj.hyperDash) drawHyperBorder(ctx, size, hyperColour, alpha);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Explode / lighting flashes at catch line
  for (const j of judgmentMap.values()) {
    if (j.result === "miss") continue;
    const age = t - j.tMs;
    if (age < 0 || age > 280) continue;
    const obj = objs[j.noteIndex];
    if (!obj) continue;
    if (obj.type === "banana") continue;
    if (obj.type === "droplet" && obj.kind === "tiny") continue;
    const u = age / 280;
    const pos = toScreen(tf, obj.x, CATCHER_Y);
    const colourIndex = comboInfo.colourIndexes[j.noteIndex] ?? 0;
    const comboColor = catchComboColorAtIndex(palette, colourIndex);
    const flashAlpha = (1 - u) * 0.7;
    if (sprites?.lighting) {
      drawTintedImage(
        ctx,
        sprites.lighting,
        pos.x,
        pos.y,
        (40 + u * 30) * tf.scale,
        comboColor,
        flashAlpha,
      );
    } else {
      ctx.globalAlpha = flashAlpha;
      ctx.fillStyle = comboColor;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, (8 + u * 18) * tf.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Catcher
  const plate = toScreen(tf, catcherX, CATCHER_Y);
  const recentMiss = (() => {
    for (const j of judgmentMap.values()) {
      if (j.result !== "miss") continue;
      const age = t - j.tMs;
      if (age < 0 || age > 400) continue;
      const obj = objs[j.noteIndex];
      if (!obj) continue;
      if (obj.type === "fruit" || (obj.type === "droplet" && obj.kind === "large")) {
        return true;
      }
    }
    return false;
  })();

  const catcherImg =
    (recentMiss && sprites?.catcherFail) ||
    sprites?.catcherIdle ||
    sprites?.catcherKiai ||
    null;

  let drewCatcher = false;
  if (catcherImg) {
    drewCatcher = drawCatcherSprite(
      ctx,
      catcherImg,
      plate,
      plateW,
      tf.scale,
      facing,
      dashing,
      skin,
    );
  }
  if (!drewCatcher) {
    drawProceduralPlate(
      ctx,
      plate,
      plateW,
      tf.scale,
      facing,
      dashing,
      skin,
    );
  }

  if (skin.showHitPopups) {
    for (const j of judgmentMap.values()) {
      const age = t - j.tMs;
      if (age < 0 || age > 280) continue;
      const obj = objs[j.noteIndex];
      if (!obj) continue;
      const u = age / 280;
      const pos = toScreen(tf, obj.x, CATCHER_Y - 24 - u * 20);
      ctx.globalAlpha = 1 - u;
      ctx.fillStyle = POPUP_COLOR[j.result];
      ctx.font = `700 ${Math.round(14 * tf.scale)}px Figtree, ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(POPUP_LABEL[j.result], pos.x, pos.y);
      ctx.globalAlpha = 1;
    }
  }
}
