import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OverlayElementInstance, OverlayProfile } from "../../lib/api";
import {
  DifficultyElement,
  IdentityElement,
  LivePlayElement,
  PersonalStatsElement,
  PreviewElement,
  ScoreListElement,
  SessionStatsElement,
  AnalysisElement,
  DensityElement,
  type OverlayElementContext,
} from "./OverlayElements";
import { clampScale, elementTriggerState } from "./profileModel";

function ElementContent({
  element,
  ctx,
}: {
  element: OverlayElementInstance;
  ctx: OverlayElementContext;
}) {
  switch (element.type) {
    case "scoreList":
      return <ScoreListElement ctx={ctx} />;
    case "identity":
      return <IdentityElement ctx={ctx} />;
    case "difficulty":
      return <DifficultyElement ctx={ctx} />;
    case "livePlay":
      return <LivePlayElement ctx={ctx} />;
    case "preview":
      return <PreviewElement ctx={ctx} element={element} />;
    case "analysis":
      return <AnalysisElement ctx={ctx} />;
    case "sessionStats":
      return <SessionStatsElement ctx={ctx} />;
    case "personalStats":
      return <PersonalStatsElement ctx={ctx} />;
    case "density":
      return <DensityElement ctx={ctx} />;
    default:
      return null;
  }
}

/** Fit-scale a fixed-size overlay stage inside its container width. */
export function useFitScale(contentWidth: number): {
  ref: React.RefObject<HTMLDivElement | null>;
  scale: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const available = el.clientWidth;
      if (available > 0 && contentWidth > 0) {
        setScale(Math.min(1, available / contentWidth));
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [contentWidth]);
  return { ref, scale };
}

export function OverlayStage({
  profile,
  ctx,
  scale: scaleOverride,
  interactive,
  selectedInstanceId,
  onElementPointerDown,
}: {
  profile: OverlayProfile;
  ctx: OverlayElementContext;
  /** Editor passes its measured scale; otherwise the stage fits itself. */
  scale?: number;
  interactive?: boolean;
  selectedInstanceId?: string | null;
  onElementPointerDown?: (
    element: OverlayElementInstance,
    event: React.PointerEvent,
  ) => void;
}) {
  const fit = useFitScale(profile.width);
  const scale = scaleOverride ?? fit.scale;
  const content = (
    <div
      className="relative overflow-hidden"
      style={{
        width: profile.width,
        height: Math.round(profile.height * scale),
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: profile.width,
          height: profile.height,
          transform: `scale(${scale})`,
          background:
            profile.bg === "solid"
              ? "linear-gradient(160deg,#101418,#0a0c10)"
              : undefined,
        }}
      >
        {profile.elements.map((element) => {
          const state = elementTriggerState(element, ctx.snapshot);
          if (!state.visible) {
            return interactive ? (
              <div
                key={element.instanceId}
                className={`absolute cursor-pointer rounded border border-dashed text-[11px] ${
                  selectedInstanceId === element.instanceId
                    ? "border-accent text-accent"
                    : "border-white/25 text-white/40"
                }`}
                style={{ left: element.x, top: element.y }}
                onPointerDown={(event) =>
                  onElementPointerDown?.(element, event)
                }
              >
                <span className="bg-black/50 px-1">
                  {element.type} · hidden by trigger
                </span>
              </div>
            ) : null;
          }
          const selected = interactive && selectedInstanceId === element.instanceId;
          return (
            <div
              key={element.instanceId}
              className={`absolute origin-top-left transition-opacity duration-500 ${
                selected ? "outline outline-1 outline-accent" : ""
              } ${interactive && !selected ? "hover:outline hover:outline-1 hover:outline-white/30" : ""}`}
              style={{
                left: element.x,
                top: element.y,
                transform: `scale(${clampScale(element.scale)})`,
                opacity: state.faded ? 0.25 : 1,
              }}
              onPointerDown={
                interactive
                  ? (event) => onElementPointerDown?.(element, event)
                  : undefined
              }
            >
              <ElementContent element={element} ctx={ctx} />
            </div>
          );
        })}
      </div>
    </div>
  );

  if (scaleOverride != null) return content;
  return <div ref={fit.ref}>{content}</div>;
}
