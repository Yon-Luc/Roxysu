import { useEffect, useRef } from "react";
import type { ScoreReplay } from "../lib/api";
import { resizePlayfieldCanvas, startPlayfieldRaf } from "../lib/playfieldRaf";
import type { StdSkin } from "../lib/stdSkin";
import {
  buildComboNumbers,
  buildHeadMap,
  paintStdPlayfield,
  type CursorTrailPoint,
  type StdHitObject,
  type StdPlayfieldFrame,
  type StdPlayfieldJudgment,
} from "../lib/paintStdPlayfield";

export type {
  StdHitObject,
  StdPlayfieldFrame,
  StdPlayfieldJudgment,
} from "../lib/paintStdPlayfield";

type StdPlayfieldProps = {
  hitObjects: StdHitObject[];
  circleSize: number;
  approachRate: number;
  getCurrentTimeMs: () => number;
  frames?: StdPlayfieldFrame[];
  judgments?: StdPlayfieldJudgment[];
  hidden?: boolean;
  skin?: StdSkin;
  className?: string;
};

/**
 * Standard (osu!) playfield — 512×384 letterboxed into the modal stage.
 * Scrub-only for preview; pass frames for replay cursor overlay.
 */
export function StdPlayfield({
  hitObjects,
  circleSize,
  approachRate,
  getCurrentTimeMs,
  frames,
  judgments,
  hidden = false,
  skin,
  className = "",
}: StdPlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectsRef = useRef<StdHitObject[]>([]);
  const getTimeRef = useRef(getCurrentTimeMs);
  const framesRef = useRef<StdPlayfieldFrame[]>([]);
  const judgmentsRef = useRef(buildHeadMap(undefined));
  const comboRef = useRef<number[]>([]);
  const csRef = useRef(circleSize);
  const arRef = useRef(approachRate);
  const hiddenRef = useRef(hidden);
  const skinRef = useRef(skin ?? null);
  const trailRef = useRef<CursorTrailPoint[]>([]);

  objectsRef.current = hitObjects;
  getTimeRef.current = getCurrentTimeMs;
  framesRef.current = frames ?? [];
  judgmentsRef.current = buildHeadMap(judgments);
  comboRef.current = buildComboNumbers(hitObjects);
  csRef.current = circleSize;
  arRef.current = approachRate;
  hiddenRef.current = hidden;
  skinRef.current = skin ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let loop: ReturnType<typeof startPlayfieldRaf> | null = null;
    function resize() {
      resizePlayfieldCanvas(canvas!, ctx!, () => loop?.invalidate());
    }

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(resize);
    });

    loop = startPlayfieldRaf({
      getTimeMs: () => getTimeRef.current(),
      snapshot: () => [
        canvas!.clientWidth,
        canvas!.clientHeight,
        objectsRef.current,
        csRef.current,
        arRef.current,
        framesRef.current,
        hiddenRef.current,
        skinRef.current,
        comboRef.current,
        judgmentsRef.current,
      ],
      paint: (tMs) => {
        paintStdPlayfield({
          ctx: ctx!,
          width: canvas!.clientWidth,
          height: canvas!.clientHeight,
          tMs,
          hitObjects: objectsRef.current,
          circleSize: csRef.current,
          approachRate: arRef.current,
          frames: framesRef.current,
          hidden: hiddenRef.current,
          skin: skinRef.current,
          trail: trailRef.current,
          comboNumbers: comboRef.current,
          judgmentMaps: judgmentsRef.current,
        });
      },
    });
    return () => {
      loop?.stop();
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`block h-full w-full ${className}`.trim()}
      aria-hidden
    />
  );
}

/** Type helper — hit objects on score replay beatmap payload. */
export type StdReplayHitObjects = NonNullable<
  ScoreReplay["beatmap"]
>["hitObjects"];
