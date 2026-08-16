import { useEffect, useRef } from "react";
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

    let raf = 0;
    let running = true;

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas!.width = Math.max(1, Math.floor(w * dpr));
      canvas!.height = Math.max(1, Math.floor(h * dpr));
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    requestAnimationFrame(() => {
      resize();
      requestAnimationFrame(resize);
    });

    function draw() {
      if (!running) return;
      paintTaikoPlayfield({
        ctx: ctx!,
        width: canvas!.clientWidth,
        height: canvas!.clientHeight,
        tMs: getTimeRef.current(),
        hitObjects: objectsRef.current,
        frames: framesRef.current,
        hidden: hiddenRef.current,
        skin: skinRef.current,
        judgmentMap: judgmentsRef.current,
      });
      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
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
