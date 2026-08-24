import { useEffect, useRef } from "react";
import { resizePlayfieldCanvas, startPlayfieldRaf } from "../lib/playfieldRaf";
import type { CatchSkin } from "../lib/catchSkin";
import catcherSpriteUrl from "../roxyctb.png";
import {
  buildCatchComboNumbers,
  buildCatchJudgmentMap,
  paintCatchPlayfield,
  type CatcherTrailPoint,
  type CatchHitObject,
  type CatchPlayfieldFrame,
  type CatchPlayfieldJudgment,
} from "../lib/paintCatchPlayfield";

export type {
  CatchHitObject,
  CatchPlayfieldFrame,
  CatchPlayfieldJudgment,
} from "../lib/paintCatchPlayfield";

type CatchPlayfieldProps = {
  hitObjects: CatchHitObject[];
  circleSize: number;
  approachRate: number;
  getCurrentTimeMs: () => number;
  frames?: CatchPlayfieldFrame[];
  judgments?: CatchPlayfieldJudgment[];
  hidden?: boolean;
  skin?: CatchSkin;
  className?: string;
};

export function CatchPlayfield({
  hitObjects,
  circleSize,
  approachRate,
  getCurrentTimeMs,
  frames,
  judgments,
  hidden = false,
  skin,
  className = "",
}: CatchPlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectsRef = useRef<CatchHitObject[]>([]);
  const getTimeRef = useRef(getCurrentTimeMs);
  const framesRef = useRef<CatchPlayfieldFrame[]>([]);
  const judgmentsRef = useRef(buildCatchJudgmentMap(undefined));
  const comboRef = useRef<number[]>([]);
  const csRef = useRef(circleSize);
  const arRef = useRef(approachRate);
  const hiddenRef = useRef(hidden);
  const skinRef = useRef(skin ?? null);
  const trailRef = useRef<CatcherTrailPoint[]>([]);
  const spriteRef = useRef<HTMLImageElement | null>(null);

  objectsRef.current = hitObjects;
  getTimeRef.current = getCurrentTimeMs;
  framesRef.current = frames ?? [];
  judgmentsRef.current = buildCatchJudgmentMap(judgments);
  comboRef.current = buildCatchComboNumbers(hitObjects);
  csRef.current = circleSize;
  arRef.current = approachRate;
  hiddenRef.current = hidden;
  skinRef.current = skin ?? null;

  useEffect(() => {
    const img = new Image();
    img.src = catcherSpriteUrl;
    img.onload = () => {
      spriteRef.current = img;
    };
  }, []);

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
        spriteRef.current,
      ],
      paint: (tMs) => {
        paintCatchPlayfield({
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
          judgmentMap: judgmentsRef.current,
          catcherSprite: spriteRef.current,
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
