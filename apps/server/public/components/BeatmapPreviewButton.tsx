import { useState } from "react";
import { createPortal } from "react-dom";
import { BeatmapPreviewModal, type ModalMode } from "./BeatmapPreviewModal";
import type { PracticeRange } from "../lib/liveManiaPlay";

type BeatmapPreviewButtonProps = {
  beatmapId: string;
  className?: string;
  /** Open directly in Play mode (e.g. future miss-practice entry). */
  initialMode?: ModalMode;
  practiceRange?: PracticeRange | null;
  /** Initial pattern mods for mania previews (e.g. ["IN"]). */
  initialMods?: string[];
};

export function BeatmapPreviewButton({
  beatmapId,
  className,
  initialMode = "preview",
  practiceRange = null,
  initialMods,
}: BeatmapPreviewButtonProps) {
  const [open, setOpen] = useState(false);

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
        Preview
      </button>
      {open
        ? createPortal(
            <BeatmapPreviewModal
              beatmapId={beatmapId}
              onClose={() => setOpen(false)}
              initialMode={initialMode}
              practiceRange={practiceRange}
              initialMods={initialMods}
            />,
            document.body,
          )
        : null}
    </>
  );
}
