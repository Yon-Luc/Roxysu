import { useState } from "react";
import { createPortal } from "react-dom";
import { ScoreReplayModal } from "./ScoreReplayModal";

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
            <ScoreReplayModal
              scoreId={scoreId}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}
