import type { RgbaImage } from "./pngRgba";
import { blitScaled } from "./playfieldRaster";

export type HoldBodyDraw = {
  spritePath: string;
  x: number;
  yBottom: number;
  width: number;
  height: number;
  alpha: number;
};

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
