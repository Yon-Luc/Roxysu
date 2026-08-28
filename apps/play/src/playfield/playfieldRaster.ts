import type { RgbaImage } from "./pngRgba";

function sampleSprite(
  sprite: RgbaImage,
  srcX: number,
  srcY: number,
): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(sprite.width - 1, Math.floor(srcX)));
  const y0 = Math.max(0, Math.min(sprite.height - 1, Math.floor(srcY)));
  const x1 = Math.min(sprite.width - 1, x0 + 1);
  const y1 = Math.min(sprite.height - 1, y0 + 1);
  const tx = srcX - x0;
  const ty = srcY - y0;

  const i00 = (y0 * sprite.width + x0) * 4;
  const i10 = (y0 * sprite.width + x1) * 4;
  const i01 = (y1 * sprite.width + x0) * 4;
  const i11 = (y1 * sprite.width + x1) * 4;

  const out: number[] = [];
  for (let c = 0; c < 4; c += 1) {
    const v00 = sprite.data[i00 + c]!;
    const v10 = sprite.data[i10 + c]!;
    const v01 = sprite.data[i01 + c]!;
    const v11 = sprite.data[i11 + c]!;
    out[c] =
      v00 * (1 - tx) * (1 - ty) +
      v10 * tx * (1 - ty) +
      v01 * (1 - tx) * ty +
      v11 * tx * ty;
  }
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}

export function blitScaled(
  target: Uint8ClampedArray,
  targetWidth: number,
  targetHeight: number,
  sprite: RgbaImage,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
  sourceHeightScale: number,
  alpha: number,
): void {
  if (destW <= 0 || destH <= 0 || sprite.width <= 0 || sprite.height <= 0) {
    return;
  }

  const sourceH = Math.max(1, sprite.height * sourceHeightScale);

  for (let row = 0; row < destH; row += 1) {
    const y = Math.floor(destY + row);
    if (y < 0 || y >= targetHeight) continue;

    const srcY = destH <= 1 ? 0 : (row / (destH - 1)) * (sourceH - 1);

    for (let col = 0; col < destW; col += 1) {
      const x = Math.floor(destX + col);
      if (x < 0 || x >= targetWidth) continue;

      const srcX =
        destW <= 1 ? 0 : (col / (destW - 1)) * (sprite.width - 1);
      const [r, g, b, a] = sampleSprite(sprite, srcX, srcY);
      const srcA = (a / 255) * alpha;
      if (srcA <= 0) continue;

      const dstIndex = (y * targetWidth + x) * 4;
      const inv = 1 - srcA;
      target[dstIndex] = r * srcA + target[dstIndex]! * inv;
      target[dstIndex + 1] = g * srcA + target[dstIndex + 1]! * inv;
      target[dstIndex + 2] = b * srcA + target[dstIndex + 2]! * inv;
      target[dstIndex + 3] = Math.min(
        255,
        a * alpha + target[dstIndex + 3]! * inv,
      );
    }
  }
}

export type SpriteDraw = {
  spritePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
};

export function drawSpriteRgba(
  target: Uint8ClampedArray,
  targetWidth: number,
  targetHeight: number,
  sprite: RgbaImage,
  draw: SpriteDraw,
): void {
  blitScaled(
    target,
    targetWidth,
    targetHeight,
    sprite,
    draw.x,
    draw.y,
    draw.width,
    draw.height,
    1,
    draw.alpha,
  );
}

export type RgbaColor = readonly [number, number, number, number];

export function parseCssColor(color: string): RgbaColor {
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = Number.parseInt(hex[0]! + hex[0]!, 16);
      const g = Number.parseInt(hex[1]! + hex[1]!, 16);
      const b = Number.parseInt(hex[2]! + hex[2]!, 16);
      return [r, g, b, 255];
    }
    if (hex.length >= 6) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      return [r, g, b, 255];
    }
  }
  return [180, 180, 180, 255];
}

export function fillRectRgba(
  target: Uint8ClampedArray,
  targetWidth: number,
  targetHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RgbaColor,
  alpha = 1,
): void {
  if (width <= 0 || height <= 0 || alpha <= 0) return;

  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(targetWidth, Math.ceil(x + width));
  const y1 = Math.min(targetHeight, Math.ceil(y + height));
  if (x0 >= x1 || y0 >= y1) return;

  const [r, g, b, a] = color;
  const srcA = (a / 255) * alpha;
  if (srcA <= 0) return;

  for (let row = y0; row < y1; row += 1) {
    for (let col = x0; col < x1; col += 1) {
      const dstIndex = (row * targetWidth + col) * 4;
      if (srcA >= 1) {
        target[dstIndex] = r;
        target[dstIndex + 1] = g;
        target[dstIndex + 2] = b;
        target[dstIndex + 3] = 255;
        continue;
      }
      const inv = 1 - srcA;
      target[dstIndex] = r * srcA + target[dstIndex]! * inv;
      target[dstIndex + 1] = g * srcA + target[dstIndex + 1]! * inv;
      target[dstIndex + 2] = b * srcA + target[dstIndex + 2]! * inv;
      target[dstIndex + 3] = Math.min(255, a * alpha + target[dstIndex + 3]! * inv);
    }
  }
}
