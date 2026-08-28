import os from "node:os";
import path from "node:path";
import { useMemo } from "react";
import { toSkinAssetUrl } from "../skin/skinFileLookup";
import { drawHoldBodyTiledRgba, type HoldBodyDraw } from "./holdBodyTiled";
import { writePngRgbaFile } from "./pngRgba";
import { loadSpriteRgbaSync } from "./spriteRgbaCache";

export type HoldBodiesLayerContent = {
  holdBodies: readonly HoldBodyDraw[];
};

function layerPathForFrame(frameVersion: number): string {
  return path.join(
    os.tmpdir(),
    `roxysu-play-hold-bodies-${frameVersion % 2}.png`,
  );
}

export function renderHoldBodiesLayer(
  width: number,
  height: number,
  content: HoldBodiesLayerContent,
  frameVersion: number,
): string | null {
  if (width <= 0 || height <= 0 || content.holdBodies.length === 0) {
    return null;
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  let drewAny = false;

  for (const draw of content.holdBodies) {
    const sprite = loadSpriteRgbaSync(draw.spritePath);
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

  const outPath = layerPathForFrame(frameVersion);
  writePngRgbaFile(outPath, width, height, rgba);
  return outPath;
}

type HoldBodiesLayerProps = {
  width: number;
  height: number;
  content: HoldBodiesLayerContent;
  frameVersion: number;
};

export function HoldBodiesLayer({
  width,
  height,
  content,
  frameVersion,
}: HoldBodiesLayerProps) {
  const layerPath = useMemo(
    () => renderHoldBodiesLayer(width, height, content, frameVersion),
    [width, height, content, frameVersion],
  );

  if (!layerPath) return null;

  return (
    <img
      key={`hold-bodies-${frameVersion}`}
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

/** @deprecated */
export function clearNotesLayerSpriteCache(): void {}
