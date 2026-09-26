import os from "node:os";
import path from "node:path";
import { drawHoldBodyTiledRgba } from "./holdBodyTiled";
import { writePngRgbaFile } from "./pngRgba";
import { loadSpriteRgbaSync } from "./spriteRgbaCache";

/**
 * Rasterize a tiled hold body into a tight local buffer (origin top-left).
 * Matches preview `drawHoldBodyTiled()` but outputs playfield-local pixels.
 */
export function rasterHoldBodyLocal(
  spritePath: string,
  width: number,
  height: number,
  alpha: number,
): Uint8ClampedArray | null {
  if (width <= 0 || height <= 0) return null;
  const sprite = loadSpriteRgbaSync(spritePath);
  if (!sprite) return null;

  const rgba = new Uint8ClampedArray(Math.ceil(width) * Math.ceil(height) * 4);
  drawHoldBodyTiledRgba(
    rgba,
    Math.ceil(width),
    Math.ceil(height),
    sprite,
    0,
    height,
    width,
    height,
    alpha,
  );
  return rgba;
}

function holdBodyCacheKey(
  noteId: number,
  spritePath: string,
  width: number,
  height: number,
  alpha: number,
): string {
  return `${noteId}:${spritePath}:${Math.round(width)}x${Math.round(height)}:${alpha.toFixed(3)}`;
}

const pathCache = new Map<string, string>();

export function renderHoldBodyAsset(args: {
  noteId: number;
  spritePath: string;
  width: number;
  height: number;
  alpha: number;
  frameVersion: number;
}): string | null {
  const w = Math.max(1, Math.round(args.width));
  const h = Math.max(1, Math.round(args.height));
  const rgba = rasterHoldBodyLocal(args.spritePath, w, h, args.alpha);
  if (!rgba) return null;

  const cacheKey = holdBodyCacheKey(
    args.noteId,
    args.spritePath,
    w,
    h,
    args.alpha,
  );
  const cachedPath = pathCache.get(cacheKey);
  if (cachedPath) {
    writePngRgbaFile(cachedPath, w, h, rgba);
    return cachedPath;
  }

  const filePath = path.join(
    os.tmpdir(),
    `roxysu-hold-${args.noteId}-${w}x${h}-${args.frameVersion % 2}.png`,
  );
  writePngRgbaFile(filePath, w, h, rgba);
  pathCache.set(cacheKey, filePath);
  return filePath;
}

export function clearHoldBodyAssetCache(): void {
  pathCache.clear();
}
