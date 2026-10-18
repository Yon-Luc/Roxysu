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

export type CatcherTrailPoint = { x: number; t: number; dashing?: boolean };

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

function nextHyperFruit(
  objects: CatchHitObject[],
  fromIndex: number,
): Extract<CatchHitObject, { type: "fruit" }> | null {
  for (let i = fromIndex + 1; i < objects.length; i += 1) {
    const o = objects[i]!;
    if (o.type === "fruit") return o;
  }
  return null;
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
): boolean {
  const dims = spriteNaturalSize(img);
  if (!dims) return false;
  const plateWFrac = 0.9;
  const spriteW = (plateW * scale) / plateWFrac;
  const spriteH = spriteW * (dims.h / dims.w);
  // Legacy catcher: first ~16px transparent at top; origin near top of plate
  const spriteY = plate.y - 16 * scale;
  const spriteX = plate.x - spriteW / 2;

  if (dashing) {
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
  try {
    ctx.drawImage(img, -spriteW / 2, -spriteH / 2, spriteW, spriteH);
  } catch {
    ctx.restore();
    return false;
  }
  ctx.restore();
  // Keep unused spriteX referenced for lint clarity — position via translate.
  void spriteX;
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

  // Hyperdash path lines (fruit → next fruit)
  for (let i = 0; i < objs.length; i += 1) {
    const obj = objs[i]!;
    if (obj.type !== "fruit" || !obj.hyperDash) continue;
    const next = nextHyperFruit(objs, i);
    if (!next) continue;
    if (obj.timeMs < t - 80 || next.timeMs > t + preempt) continue;
    if (obj.timeMs > t + preempt) continue;
    const judged = judgmentMap.get(i);
    if (judged && judged.tMs <= t && judged.result !== "miss") continue;
    const a = toScreen(tf, obj.x, CATCHER_Y * Math.max(0, 1 - (obj.timeMs - t) / preempt));
    // Line from current fruit fall position toward next fruit's catch point
    const fruitY = (() => {
      const dt = obj.timeMs - t;
      if (dt > preempt || dt < -80) return null;
      return (1 - dt / preempt) * CATCHER_Y;
    })();
    if (fruitY == null) continue;
    const from = toScreen(tf, obj.x, fruitY);
    const to = toScreen(tf, next.x, CATCHER_Y);
    ctx.strokeStyle = hexToRgba(skin.hyperDashFruit || skin.hyperDash, 0.55);
    ctx.lineWidth = 2 * tf.scale;
    ctx.setLineDash([6 * tf.scale, 4 * tf.scale]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);
    void a;
  }

  if (trail && catcher) {
    trail.push({ x: catcher.x, t, dashing });
    while (trail.length > 0 && t - trail[0]!.t > 220) trail.shift();
  }

  // Hyperdash afterimage / trail
  if (skin.showTrail || dashing) {
    const pts =
      trail && trail.length > 1
        ? trail
        : frames
            .filter((f) => f.tMs <= t && t - f.tMs <= 220)
            .map((f) => ({ x: f.x, t: f.tMs, dashing: f.dashing }));
    if (pts.length > 1) {
      for (let i = 1; i < pts.length; i += 1) {
        const p0 = pts[i - 1]!;
        const p1 = pts[i]!;
        const age = t - p1.t;
        const a = Math.max(0, 1 - age / 220) * (p1.dashing || dashing ? 0.55 : 0.22);
        if (a <= 0) continue;
        const s0 = toScreen(tf, p0.x, CATCHER_Y);
        const s1 = toScreen(tf, p1.x, CATCHER_Y);
        ctx.strokeStyle = hexToRgba(
          p1.dashing || dashing
            ? skin.hyperDashAfterImage || skin.hyperDash
            : "#ffffff",
          a,
        );
        ctx.lineWidth = (p1.dashing || dashing ? 4 : 2) * tf.scale;
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.stroke();
      }
    }
  }

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
    ctx.globalAlpha = alpha;

    if (obj.type === "banana") {
      const size = 28 * tf.scale;
      const drawn =
        sprites?.bananas &&
        drawSpriteCentered(ctx, sprites.bananas, pos.x, pos.y, size, alpha);
      if (drawn && sprites?.bananasOverlay) {
        drawSpriteCentered(
          ctx,
          sprites.bananasOverlay,
          pos.x,
          pos.y,
          size,
          alpha,
        );
      }
      if (!drawn) {
        const r = 7 * tf.scale;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y, r * 0.7, r, -0.4, 0, Math.PI * 2);
        ctx.fillStyle = skin.banana;
        ctx.fill();
      }
    } else if (obj.type === "droplet") {
      const size = (obj.kind === "large" ? 22 : 14) * tf.scale;
      const drawn =
        sprites?.drop &&
        drawTintedImage(
          ctx,
          sprites.drop,
          pos.x,
          pos.y,
          size,
          skin.droplet,
          alpha,
        );
      if (drawn && sprites?.dropOverlay) {
        drawSpriteCentered(
          ctx,
          sprites.dropOverlay,
          pos.x,
          pos.y,
          size,
          alpha,
        );
      }
      if (!drawn) {
        const r = (obj.kind === "large" ? 6 : 3.5) * tf.scale;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = skin.droplet;
        ctx.fill();
      }
    } else {
      const colourIndex = comboInfo.colourIndexes[i] ?? 0;
      const comboColor = catchComboColorAtIndex(palette, colourIndex);
      const kind = fruitKindForIndex(obj.indexInBeatmap ?? i);
      const { base, overlay } = fruitSpritesFor(sprites, kind);
      const size = 36 * tf.scale;
      const tint = obj.hyperDash ? null : comboColor;
      let drawn = false;
      if (base) {
        drawn = drawTintedImage(ctx, base, pos.x, pos.y, size, tint, alpha);
        if (drawn && overlay) {
          drawSpriteCentered(ctx, overlay, pos.x, pos.y, size, alpha);
        }
      }
      if (!drawn) {
        const r = 11 * tf.scale;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.fillStyle = obj.hyperDash
          ? skin.hyperDashFruit || skin.hyperDash
          : comboColor;
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (obj.hyperDash) {
        const r = 13 * tf.scale;
        ctx.strokeStyle = skin.hyperDashFruit || skin.hyperDash;
        ctx.lineWidth = 2.5 * tf.scale;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
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
