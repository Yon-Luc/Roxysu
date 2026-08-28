import type { CanvasPlayfieldRenderArgs } from "./backends/CanvasPlayfieldBackend";
import { renderPlayfieldCanvas } from "./backends/CanvasPlayfieldBackend";
import { toSkinAssetUrl } from "../skin/skinFileLookup";

type PlayfieldCanvasLayerProps = CanvasPlayfieldRenderArgs;

/**
 * Single GPUI `<img>` for the entire playfield — notes, holds, receptors, lanes.
 * Avoids per-note atlas slots by compositing on the CPU each frame.
 */
export function PlayfieldCanvasLayer(props: PlayfieldCanvasLayerProps) {
  const layerSrc = renderPlayfieldCanvas(props);
  if (!layerSrc) return null;

  return (
    <img
      key="playfield-canvas"
      src={toSkinAssetUrl(layerSrc)}
      objectFit="fill"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: props.snapshot.width,
        height: props.snapshot.playfieldHeight,
        pointerEvents: "none",
      }}
    />
  );
}
