import { useEffect, useId, useRef } from "react";
import { useAppDict } from "../../lib/i18n";
import {
  DEFAULT_NOW_SELECTED_LAYOUT,
  moveWidget,
  NOW_SELECTED_WIDGETS,
  clampPreviewHeightRem,
  PREVIEW_HEIGHT_MAX,
  PREVIEW_HEIGHT_MIN,
  type NowSelectedLayout,
  type NowSelectedWidgetId,
} from "./nowSelectedLayout";

function widgetLabel(
  id: NowSelectedWidgetId,
  dict: ReturnType<typeof useAppDict>["dict"],
): string {
  const labels = dict?.nowSelected.widgets;
  switch (id) {
    case "identity":
      return labels?.identity ?? "Identity";
    case "preview":
      return labels?.preview ?? "Preview";
    case "patternWeights":
      return labels?.patternWeights ?? "Pattern weights";
    case "densityOverTime":
      return labels?.densityOverTime ?? "Density over time";
    case "livePlay":
      return labels?.livePlay ?? "Live play";
    case "rating":
      return labels?.rating ?? "Rating";
    case "hotspots":
      return labels?.hotspots ?? "Hotspots";
    case "personalStats":
      return labels?.personalStats ?? "Personal stats";
  }
}

export function NowSelectedSettingsModal({
  layout,
  focus,
  onChange,
  onFocusChange,
  onClose,
}: {
  layout: NowSelectedLayout;
  focus: boolean;
  onChange: (next: NowSelectedLayout) => void;
  onFocusChange: (next: boolean) => void;
  onClose: () => void;
}) {
  const { dict } = useAppDict();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const ns = dict?.nowSelected;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-elevated shadow-2xl shadow-black/60 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-white/5 px-5 py-4">
          <h2 id={titleId} className="font-display text-lg font-bold text-ink">
            {ns?.layoutTitle ?? "Now selected layout"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {ns?.layoutHint ??
              "Choose what this page shows and in which order."}
          </p>
        </div>

        <div className="space-y-5 px-5 py-4">
          <label className="flex cursor-pointer gap-3 rounded-xl bg-canvas/50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={focus}
              onChange={(e) => onFocusChange(e.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <div>
              <div className="text-sm font-semibold text-ink">
                {ns?.focusLayout ?? "Focus layout"}
              </div>
              <div className="text-xs text-muted">
                {ns?.focusLayoutHint ??
                  "Hide the sidebar so this page can fill a second monitor."}
              </div>
            </div>
          </label>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={layout.autoPlayPreview}
                onChange={(e) =>
                  onChange({ ...layout, autoPlayPreview: e.target.checked })
                }
                className="accent-[var(--color-accent)]"
              />
              {ns?.autoPlayPreview ?? "Auto-play preview"}
            </label>
            <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={layout.mutePreview}
                onChange={(e) =>
                  onChange({ ...layout, mutePreview: e.target.checked })
                }
                className="accent-[var(--color-accent)]"
              />
              {ns?.mutePreview ?? "Mute preview"}
            </label>
            <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={layout.pauseWhilePlaying}
                onChange={(e) =>
                  onChange({ ...layout, pauseWhilePlaying: e.target.checked })
                }
                className="accent-[var(--color-accent)]"
              />
              {ns?.pauseWhilePlaying ?? "Pause preview while playing in-game"}
            </label>
            <label className="block pt-1">
              <span className="mb-1.5 flex items-center justify-between text-sm text-ink">
                <span>{ns?.height ?? "Playfield height"}</span>
                <span className="tabular-nums text-muted">
                  {layout.previewHeightRem}
                </span>
              </span>
              <input
                type="range"
                min={PREVIEW_HEIGHT_MIN}
                max={PREVIEW_HEIGHT_MAX}
                step={1}
                value={layout.previewHeightRem}
                onInput={(e) =>
                  onChange({
                    ...layout,
                    previewHeightRem: clampPreviewHeightRem(
                      Number(e.currentTarget.value),
                    ),
                  })
                }
                className="w-full accent-[var(--color-accent)]"
                aria-label={ns?.height ?? "Playfield height"}
              />
            </label>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">
              {ns?.widgetsHeading ?? "Widgets"}
            </h3>
            <ul className="space-y-1">
              {layout.order.map((id, index) => (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-lg border border-white/8 bg-canvas/40 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={layout.visible[id]}
                    onChange={(e) =>
                      onChange({
                        ...layout,
                        visible: { ...layout.visible, [id]: e.target.checked },
                      })
                    }
                    className="accent-[var(--color-accent)]"
                    aria-label={widgetLabel(id, dict)}
                  />
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink">
                    {widgetLabel(id, dict)}
                  </span>
                  <button
                    type="button"
                    className="rx-btn !px-2 !py-1 text-xs"
                    disabled={index === 0}
                    onClick={() =>
                      onChange({
                        ...layout,
                        order: moveWidget(layout.order, id, -1),
                      })
                    }
                    aria-label={ns?.moveUp ?? "Move up"}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="rx-btn !px-2 !py-1 text-xs"
                    disabled={index === layout.order.length - 1}
                    onClick={() =>
                      onChange({
                        ...layout,
                        order: moveWidget(layout.order, id, 1),
                      })
                    }
                    aria-label={ns?.moveDown ?? "Move down"}
                  >
                    ↓
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex justify-between gap-2 border-t border-white/5 px-5 py-4">
          <button
            type="button"
            className="rx-btn"
            onClick={() =>
              onChange({
                ...DEFAULT_NOW_SELECTED_LAYOUT,
                order: [...NOW_SELECTED_WIDGETS],
                visible: { ...DEFAULT_NOW_SELECTED_LAYOUT.visible },
              })
            }
          >
            {ns?.resetLayout ?? "Reset"}
          </button>
          <button type="button" className="rx-btn-primary" onClick={onClose}>
            {ns?.done ?? "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
