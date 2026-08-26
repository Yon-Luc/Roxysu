import { clamp } from "../../server/public/lib/clamp";

/**
 * "Roxysu" watermark drawn onto the counter canvas — same idea as the
 * replay-video-export footer stamp: roxy logo + wordmark, bottom left.
 */

let logo: HTMLImageElement | null = null;
let loadStarted = false;
/** True once loading finished (success or failure) — snapshot repaint signal. */
let settled = false;

export function loadWatermarkLogo(): void {
  if (loadStarted || typeof Image === "undefined") return;
  loadStarted = true;
  const img = new Image();
  const done = () => {
    settled = true;
  };
  img.onload = () => {
    logo = img;
    done();
  };
  img.onerror = done;
  img.src = "./roxy-small.png";
}

/** Include in the paint snapshot so a late logo arrival triggers a repaint. */
export function watermarkSettled(): boolean {
  return settled;
}

/** Logo + wordmark size scales gently with canvas height (CSS px). */
export function watermarkSize(heightPx: number): number {
  return clamp(Math.round(heightPx / 26), 16, 32);
}

export function drawWatermark(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const size = watermarkSize(height);
  const pad = Math.round(size * 0.55);
  const text = "Roxysu";

  ctx.save();
  ctx.font = `700 ${size}px Outfit, Figtree, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const textW = ctx.measureText(text).width;

  // Subtle backdrop pill so the mark stays readable over falling notes.
  const boxW = size + (logo ? size * 0.35 : 0) + textW + pad * 1.6;
  const boxH = size + pad * 0.9;
  const boxX = pad * 0.6;
  const boxY = height - boxH - pad * 0.6;

  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  ctx.beginPath();
  const r = Math.min(boxH / 2, 10);
  ctx.moveTo(boxX + r, boxY);
  ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
  ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
  ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r);
  ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
  ctx.closePath();
  ctx.fill();

  const cy = boxY + boxH / 2;
  let x = boxX + pad * 0.8;

  if (logo && logo.naturalWidth > 0) {
    ctx.globalAlpha = 0.9;
    ctx.drawImage(logo, x, cy - size / 2, size, size);
    ctx.globalAlpha = 1;
    x += size + size * 0.35;
  }

  ctx.fillStyle = "rgba(244, 244, 245, 0.88)";
  ctx.fillText(text, x, cy + 1);

  ctx.restore();
}
