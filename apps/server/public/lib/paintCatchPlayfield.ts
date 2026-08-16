import type { BeatmapPreview } from "./api";
import type { ReplayJudgmentResult } from "./paintManiaNotefield";
import {
  catchComboColorFor,
  defaultCatchSkin,
  type CatchSkin,
} from "./catchSkin";

export type PaintContext2D =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

const OSU_WIDTH = 512;
const OSU_HEIGHT = 384;
const CATCHER_Y = 344;

export type CatchHitObject = NonNullable<
  BeatmapPreview["catchHitObjects"]
>[number];

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

export type CatcherTrailPoint = { x: number; t: number };

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
): { x: number; dashing: boolean } | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.tMs <= t) lo = mid + 1;
    else hi = mid;
  }
  const idx = lo - 1;
  if (idx < 0) return { x: frames[0]!.x, dashing: false };
  const a = frames[idx]!;
  const b = frames[idx + 1];
  if (!b || b.tMs === a.tMs) return { x: a.x, dashing: a.dashing };
  const u = Math.min(1, Math.max(0, (t - a.tMs) / (b.tMs - a.tMs)));
  return { x: a.x + (b.x - a.x) * u, dashing: a.dashing };
}

export function buildCatchComboNumbers(objects: CatchHitObject[]): number[] {
  const out = new Array<number>(objects.length).fill(0);
  let combo = 0;
  for (let i = 0; i < objects.length; i += 1) {
    const obj = objects[i]!;
    if (obj.type !== "fruit") continue;
    combo += 1;
    out[i] = combo;
  }
  return out;
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
  comboNumbers?: number[];
  judgmentMap?: Map<number, CatchPlayfieldJudgment>;
  /** Roxy portrait drawn under the plate. */
  catcherSprite?: CanvasImageSource | null;
};

export function paintCatchPlayfield(args: PaintCatchPlayfieldArgs): void {
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
    catcherSprite,
  } = args;
  const skin = skinArg ?? defaultCatchSkin();
  const comboNumbers = args.comboNumbers ?? buildCatchComboNumbers(objs);
  const judgmentMap = args.judgmentMap ?? buildCatchJudgmentMap(args.judgments);
  const tf = playfieldTransform(w, h);
  const preempt = approachPreemptMs(ar);
  const plateW = catcherWidth(cs) * skin.catcherScale;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c0c12";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#14141c";
  ctx.fillRect(tf.ox, tf.oy, OSU_WIDTH * tf.scale, OSU_HEIGHT * tf.scale);

  const frames =
    framesArg.length > 0 ? framesArg : autoCatchFrames(objs);
  const catcher = interpolateCatcher(frames, t);
  const catcherX = catcher?.x ?? OSU_WIDTH / 2;

  if (trail && catcher) {
    trail.push({ x: catcher.x, t });
    while (trail.length > 0 && t - trail[0]!.t > 180) trail.shift();
  }
  if (skin.showTrail) {
    const pts =
      trail && trail.length > 1
        ? trail
        : frames
            .filter((f) => f.tMs <= t && t - f.tMs <= 180)
            .map((f) => ({ x: f.x, t: f.tMs }));
    if (pts.length > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 2 * tf.scale;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 1) {
        const p = toScreen(tf, pts[i]!.x, CATCHER_Y);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

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
      const r = 7 * tf.scale;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, r * 0.7, r, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = skin.banana;
      ctx.fill();
    } else if (obj.type === "droplet") {
      const r = (obj.kind === "large" ? 6 : 3.5) * tf.scale;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = skin.droplet;
      ctx.fill();
    } else {
      const combo = comboNumbers[i] || 1;
      const color = obj.hyperDash ? skin.hyperDash : catchComboColorFor(skin, combo);
      const r = 11 * tf.scale;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const plate = toScreen(tf, catcherX, CATCHER_Y);
  const sprite = spriteNaturalSize(catcherSprite);
  if (sprite) {
    const plateWFrac = 0.9;
    const plateYFrac = 0.24;
    const spriteW = (plateW * tf.scale) / plateWFrac;
    const spriteH = spriteW * (sprite.h / sprite.w);
    const spriteX = plate.x - spriteW / 2;
    const spriteY = plate.y - spriteH * plateYFrac;
    if (catcher?.dashing) {
      ctx.fillStyle = "rgba(251,113,133,0.28)";
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
    ctx.drawImage(catcherSprite!, spriteX, spriteY, spriteW, spriteH);
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
