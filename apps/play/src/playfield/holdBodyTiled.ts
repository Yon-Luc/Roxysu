import type { RgbaImage } from "./pngRgba";

export type HoldBodyDraw = {
  spritePath: string;
  x: number;
  yBottom: number;
  width: number;
  height: number;
  alpha: number;
};

function blitScaled(
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
  const sourceH = Math.max(1, sprite.height * sourceHeightScale);

  for (let row = 0; row < destH; row += 1) {
    const y = Math.floor(destY + row);
    if (y < 0 || y >= targetHeight) continue;

    const srcY = Math.min(sprite.height - 1, Math.floor((row / destH) * sourceH));

    for (let col = 0; col < destW; col += 1) {
      const x = Math.floor(destX + col);
      if (x < 0 || x >= targetWidth) continue;

      const srcX = Math.min(sprite.width - 1, Math.floor((col / destW) * sprite.width));
      const srcIndex = (srcY * sprite.width + srcX) * 4;
      const dstIndex = (y * targetWidth + x) * 4;
      const srcA = (sprite.data[srcIndex + 3]! / 255) * alpha;
      if (srcA <= 0) continue;

      const inv = 1 - srcA;
      target[dstIndex] = sprite.data[srcIndex]! * srcA + target[dstIndex]! * inv;
      target[dstIndex + 1] =
        sprite.data[srcIndex + 1]! * srcA + target[dstIndex + 1]! * inv;
      target[dstIndex + 2] =
        sprite.data[srcIndex + 2]! * srcA + target[dstIndex + 2]! * inv;
      target[dstIndex + 3] = Math.min(
        255,
        sprite.data[srcIndex + 3]! * alpha + target[dstIndex + 3]! * inv,
      );
    }
  }
}

/**
 * Tile a hold-body sprite from bottom to top, clipping to the destination rect.
 * Matches `drawHoldBodyTiled()` in apps/server/public/lib/paintManiaNotefield.ts.
 */
export function drawHoldBodyTiledRgba(
  target: Uint8ClampedArray,
  targetWidth: number,
  targetHeight: number,
  sprite: RgbaImage,
  x: number,
  yBottom: number,
  width: number,
  height: number,
  alpha: number,
): void {
  if (width <= 0 || height <= 0 || sprite.width <= 0 || sprite.height <= 0) {
    return;
  }

  const tileH = width * (sprite.height / sprite.width);
  let y = yBottom;
  const yTop = yBottom - height;

  while (y > yTop) {
    const segH = Math.min(tileH, y - yTop);
    const destY = y - segH;
    blitScaled(
      target,
      targetWidth,
      targetHeight,
      sprite,
      x,
      destY,
      width,
      segH,
      segH / tileH,
      alpha,
    );
    y -= segH;
  }
}
