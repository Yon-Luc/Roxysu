import os from "node:os";
import path from "node:path";
import { useMemo } from "react";
import { toSkinAssetUrl } from "../skin/skinFileLookup";
import { drawHoldBodyTiledRgba, type HoldBodyDraw } from "./holdBodyTiled";
import { decodePngRgba, writePngRgbaFile, type RgbaImage } from "./pngRgba";

const LAYER_PATH = path.join(os.tmpdir(), "roxysu-play-hold-bodies.png");

const spriteCache = new Map<string, RgbaImage | null>();

function loadSprite(filePath: string): RgbaImage | null {
  const cached = spriteCache.get(filePath);
  if (cached !== undefined) return cached;
  const decoded = decodePngRgba(filePath);
  spriteCache.set(filePath, decoded);
  return decoded;
}

export function renderHoldBodiesLayer(
  width: number,
  height: number,
  draws: HoldBodyDraw[],
): string | null {
  if (draws.length === 0) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  let drewAny = false;

  for (const draw of draws) {
    const sprite = loadSprite(draw.spritePath);
    if (!sprite) continue;
    drawHoldBodyTiledRgba(
      rgba,
      width,
      height,
      sprite,
      draw.x,
      draw.yBottom,
      draw.width,
      draw.height,
      draw.alpha,
    );
    drewAny = true;
  }

  if (!drewAny) return null;

  writePngRgbaFile(LAYER_PATH, width, height, rgba);
  return LAYER_PATH;
}

type HoldBodiesLayerProps = {
  width: number;
  height: number;
  draws: HoldBodyDraw[];
  frameVersion: number;
};

export function HoldBodiesLayer({
  width,
  height,
  draws,
  frameVersion,
}: HoldBodiesLayerProps) {
  void frameVersion;

  const layerPath = useMemo(
    () => renderHoldBodiesLayer(width, height, draws),
    [width, height, draws, frameVersion],
  );

  if (!layerPath) return null;

  return (
    <img
      src={toSkinAssetUrl(layerPath)}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        pointerEvents: "none",
      }}
    />
  );
}

export function clearHoldBodySpriteCache(): void {
  spriteCache.clear();
}
