import { useEffect, useRef } from "react";
import { resizePlayfieldCanvas, startPlayfieldRaf } from "../lib/playfieldRaf";
import type { TaikoSkin } from "../lib/taikoSkin";
import {
  buildTaikoJudgmentMap,
  paintTaikoPlayfield,
  type TaikoHitObject,
  type TaikoPlayfieldFrame,
  type TaikoPlayfieldJudgment,
} from "../lib/paintTaikoPlayfield";

export type {
  TaikoHitObject,
  TaikoPlayfieldFrame,
  TaikoPlayfieldJudgment,
} from "../lib/paintTaikoPlayfield";

type TaikoPlayfieldProps = {
  hitObjects: TaikoHitObject[];
  getCurrentTimeMs: () => number;
  frames?: TaikoPlayfieldFrame[];
  judgments?: TaikoPlayfieldJudgment[];
  hidden?: boolean;
  skin?: TaikoSkin;
  className?: string;
};

export function TaikoPlayfield({
  hitObjects,
  getCurrentTimeMs,
  frames,
  judgments,
  hidden = false,
  skin,
  className = "",
}: TaikoPlayfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectsRef = useRef<TaikoHitObject[]>([]);
  const getTimeRef = useRef(getCurrentTimeMs);
  const framesRef = useRef<TaikoPlayfieldFrame[]>([]);
  const judgmentsRef = useRef(buildTaikoJudgmentMap(undefined));
  const hiddenRef = useRef(hidden);
  const skinRef = useRef(skin ?? null);

  objectsRef.current = hitObjects;
  getTimeRef.current = getCurrentTimeMs;
  framesRef.current = frames ?? [];
  judgmentsRef.current = buildTaikoJudgmentMap(judgments);
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
        framesRef.current,
        hiddenRef.current,
        skinRef.current,
        judgmentsRef.current,
      ],
      paint: (tMs) => {
        paintTaikoPlayfield({
          ctx: ctx!,
          width: canvas!.clientWidth,
          height: canvas!.clientHeight,
          tMs,
          hitObjects: objectsRef.current,
          frames: framesRef.current,
          hidden: hiddenRef.current,
          skin: skinRef.current,
          judgmentMap: judgmentsRef.current,
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
