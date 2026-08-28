import os from "node:os";
import path from "node:path";
import { useMemo } from "react";
import { toSkinAssetUrl } from "../skin/skinFileLookup";
import { drawHoldBodyTiledRgba, type HoldBodyDraw } from "./holdBodyTiled";
import { drawSpriteRgba, type SpriteDraw } from "./playfieldRaster";
import { writePngRgbaFile } from "./pngRgba";
import { loadSpriteRgbaSync } from "./spriteRgbaCache";

const LAYER_PATHS = [
  path.join(os.tmpdir(), "roxysu-play-hold-bodies-a.png"),
  path.join(os.tmpdir(), "roxysu-play-hold-bodies-b.png"),
] as const;

export type HoldNotesLayerContent = {
  holdBodies: readonly HoldBodyDraw[];
  /** Hold tails only — heads scroll via direct skin sprites. */
  tails: readonly SpriteDraw[];
};

function layerPathForFrame(frameVersion: number): string {
  return LAYER_PATHS[frameVersion % 2]!;
}

export function renderHoldNotesLayer(
  width: number,
  height: number,
  content: HoldNotesLayerContent,
  frameVersion: number,
): string | null {
  if (width <= 0 || height <= 0) return null;
  if (content.holdBodies.length === 0 && content.tails.length === 0) {
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

  for (const draw of content.tails) {
    const sprite = loadSpriteRgbaSync(draw.spritePath);
    if (!sprite) continue;
    drawSpriteRgba(rgba, width, height, sprite, draw);
    drewAny = true;
  }

  if (!drewAny) return null;

  const outPath = layerPathForFrame(frameVersion);
  writePngRgbaFile(outPath, width, height, rgba);
  return outPath;
}

type HoldNotesLayerProps = {
  width: number;
  height: number;
  content: HoldNotesLayerContent;
  frameVersion: number;
};

/** One GPUI `<img>` for hold bodies and tails (tiling cannot use per-note imgs). */
export function HoldNotesLayer({
  width,
  height,
  content,
  frameVersion,
}: HoldNotesLayerProps) {
  const layerPath = useMemo(
    () => renderHoldNotesLayer(width, height, content, frameVersion),
    [width, height, content, frameVersion],
  );

  if (!layerPath) return null;

  return (
    <img
      key="hold-notes-layer"
      src={toSkinAssetUrl(layerPath)}
      objectFit="fill"
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
