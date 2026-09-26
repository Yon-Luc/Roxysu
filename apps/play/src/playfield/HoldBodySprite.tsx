import { toSkinAssetUrl } from "../skin/skinFileLookup";
import { renderHoldBodyAsset } from "./renderHoldBodyLocal";

type HoldBodySpriteProps = {
  noteId: number;
  spritePath: string;
  left: number;
  top: number;
  width: number;
  height: number;
  alpha: number;
  frameVersion: number;
};

/**
 * One GPUI `<img>` per hold body. The PNG is hold-local (tiled like preview);
 * screen motion comes from updating `top`/`left` each frame — not a full-playfield layer.
 */
export function HoldBodySprite({
  noteId,
  spritePath,
  left,
  top,
  width,
  height,
  alpha,
  frameVersion,
}: HoldBodySpriteProps) {
  if (width <= 0 || height <= 0) return null;

  const assetPath = renderHoldBodyAsset({
    noteId,
    spritePath,
    width,
    height,
    alpha,
    frameVersion,
  });
  if (!assetPath) return null;

  return (
    <img
      key={`hold-body-${noteId}`}
      src={toSkinAssetUrl(assetPath)}
      objectFit="fill"
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        pointerEvents: "none",
      }}
    />
  );
}
