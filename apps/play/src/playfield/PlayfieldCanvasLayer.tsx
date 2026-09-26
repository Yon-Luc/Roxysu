import { useEffect, useRef, useState } from "react";
import type { Game } from "../game/Game";
import type { PlayfieldSkin } from "../skin/PlayfieldSkin";
import type { PlayfieldSkinLayout } from "../skin/skinLayout";
import type { CanvasPlayfieldRenderArgs } from "./backends/CanvasPlayfieldBackend";
import { renderPlayfieldCanvas } from "./backends/CanvasPlayfieldBackend";
import type { PlayfieldColumnSnapshot } from "./PlayfieldTypes";
import {
  PLAYFIELD_RING_SIZE,
  playfieldSurfacePath,
  primePlayfieldSurfaceRing,
} from "./playfieldSurfacePaths";
import { toSkinAssetUrl } from "../skin/skinFileLookup";

/** GPUIX has no rAF — match game loop (~240 Hz) via setTimeout. */
const COMPOSITE_INTERVAL_MS = 4;

type PlayfieldCanvasLayerProps = {
  game: Game;
  /** When false, composes once and stops (paused). */
  active: boolean;
  width: number;
  height: number;
  skin: PlayfieldSkin;
  layout: PlayfieldSkinLayout;
  columns: readonly PlayfieldColumnSnapshot[];
  receptorY: number;
  separatorColor: string;
  staticKey: string;
  mode?: CanvasPlayfieldRenderArgs["mode"];
};

type CompositorArgs = Omit<
  PlayfieldCanvasLayerProps,
  "game" | "active"
>;

/**
 * Single GPUI `<img>` for the entire playfield.
 * Compositor runs on its own timer with live song time — not React frameVersion.
 * Ring paths include a generation suffix so GPUI never serves a stale cached slot.
 */
export function PlayfieldCanvasLayer({
  game,
  active,
  width,
  height,
  skin,
  layout,
  columns,
  receptorY,
  separatorColor,
  staticKey,
  mode,
}: PlayfieldCanvasLayerProps) {
  const [srcPath, setSrcPath] = useState<string | null>(null);
  const argsRef = useRef<CompositorArgs>({
    width,
    height,
    skin,
    layout,
    columns,
    receptorY,
    separatorColor,
    staticKey,
    mode,
  });
  argsRef.current = {
    width,
    height,
    skin,
    layout,
    columns,
    receptorY,
    separatorColor,
    staticKey,
    mode,
  };

  const surfaceFrameRef = useRef(0);
  const displayedPathRef = useRef<string | null>(null);
  const primedSizeRef = useRef<string | null>(null);
  const lastStaticKeyRef = useRef("");

  useEffect(() => {
    let running = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const compositeFrame = (): string | null => {
      const timeMs = game.getSongTimeMs();
      game.playfield.setSongTime(timeMs);
      const snapshot = game.playfield.getSnapshot();
      const args = argsRef.current;
      const fieldWidth = snapshot.width;
      const fieldHeight = snapshot.playfieldHeight;
      if (fieldWidth <= 0 || fieldHeight <= 0) return null;

      const sizeKey = `${fieldWidth}x${fieldHeight}`;
      if (primedSizeRef.current !== sizeKey) {
        primePlayfieldSurfaceRing(
          fieldWidth,
          fieldHeight,
          args.skin.playfieldBackground,
        );
        primedSizeRef.current = sizeKey;
        surfaceFrameRef.current = 0;
        displayedPathRef.current = null;
      }

      if (lastStaticKeyRef.current !== args.staticKey) {
        surfaceFrameRef.current = 0;
        displayedPathRef.current = null;
        lastStaticKeyRef.current = args.staticKey;
      }

      surfaceFrameRef.current += 1;
      const frame = surfaceFrameRef.current;
      const slot = frame % PLAYFIELD_RING_SIZE;
      const generation = Math.floor(frame / PLAYFIELD_RING_SIZE);
      const nextPath = playfieldSurfacePath(slot, generation);

      if (nextPath === displayedPathRef.current) {
        return displayedPathRef.current;
      }

      const wrote = renderPlayfieldCanvas({
        snapshot,
        skin: args.skin,
        layout: args.layout,
        columns: args.columns,
        receptorY: args.receptorY,
        separatorColor: args.separatorColor,
        staticKey: args.staticKey,
        mode: args.mode,
        outPath: nextPath,
      });
      if (!wrote) return displayedPathRef.current;

      displayedPathRef.current = nextPath;
      return nextPath;
    };

    const publish = (path: string | null) => {
      if (path) setSrcPath(path);
    };

    if (!active) {
      publish(compositeFrame());
      return () => {
        running = false;
      };
    }

    const tick = () => {
      if (!running) return;
      publish(compositeFrame());
      timer = setTimeout(tick, COMPOSITE_INTERVAL_MS);
    };

    publish(compositeFrame());
    timer = setTimeout(tick, COMPOSITE_INTERVAL_MS);

    return () => {
      running = false;
      if (timer) clearTimeout(timer);
    };
  }, [game, active]);

  if (!srcPath || width <= 0 || height <= 0) {
    return null;
  }

  return (
    <img
      key="playfield-surface"
      src={toSkinAssetUrl(srcPath)}
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
