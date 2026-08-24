import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";

const ScoreReplayModal = lazy(() =>
  import("./ScoreReplayModal").then((m) => ({ default: m.ScoreReplayModal })),
);

type ScoreReplayButtonProps = {
  scoreId: string;
  /** When false, button is hidden. */
  enabled?: boolean;
  className?: string;
  label?: string;
};

export function ScoreReplayButton({
  scoreId,
  enabled = true,
  className,
  label = "Rewatch",
}: ScoreReplayButtonProps) {
  const [open, setOpen] = useState(false);
  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={className ?? "rx-btn"}
      >
        {label}
      </button>
      {open
        ? createPortal(
            <Suspense
              fallback={
                <div className="fixed inset-0 z-50 bg-black/80" aria-hidden />
              }
            >
              <ScoreReplayModal
                scoreId={scoreId}
                onClose={() => setOpen(false)}
              />
            </Suspense>,
            document.body,
          )
        : null}
    </>
  );
}
