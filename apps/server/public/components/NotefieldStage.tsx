import {
  ManiaNotefield,
  type NotefieldFrame,
  type NotefieldJudgment,
} from "./ManiaNotefield";
import { TimingVisualizer } from "./TimingVisualizer";
import type { HitWindows } from "../lib/maniaWindows";
import type { BeatmapPreview } from "../lib/api";

type NotefieldStageProps = {
  columnCount: number;
  notes: BeatmapPreview["notes"];
  scrollSpeed: number;
  playbackRate: number;
  liveHeldMask: number | null;
  getCurrentTimeMs: () => number;
  /** Timing visualizer center X (% of playfield). */
  timingX: number;
  /** Timing visualizer center Y (% of playfield). */
  timingY: number;
  onMoveTiming: (xPct: number, yPct: number) => void;
  windows: HitWindows;
  /** Show the timing visualizer overlay (Play mode). */
  showTiming: boolean;
  judgments?: NotefieldJudgment[];
  frames?: NotefieldFrame[];
  highlightMissNotes?: boolean;
};

/** Mania notefield + timing visualizer, wrapped in a clipped stage. */
export function NotefieldStage({
  columnCount,
  notes,
  scrollSpeed,
  playbackRate,
  liveHeldMask,
  getCurrentTimeMs,
  timingX,
  timingY,
  onMoveTiming,
  windows,
  showTiming,
  judgments,
  frames,
  highlightMissNotes,
}: NotefieldStageProps) {
  return (
    <div className="relative h-full w-full">
      <div className="h-full w-full overflow-hidden rounded-xl">
        <ManiaNotefield
          columnCount={columnCount}
          notes={notes}
          frames={frames}
          judgments={judgments}
          highlightMissNotes={highlightMissNotes}
          scrollSpeed={scrollSpeed}
          playbackRate={playbackRate}
          liveHeldMask={liveHeldMask}
          getCurrentTimeMs={getCurrentTimeMs}
        />
      </div>
      {showTiming ? (
        <TimingVisualizer
          judgments={judgments ?? []}
          windows={windows}
          xPct={timingX}
          yPct={timingY}
          onMove={onMoveTiming}
        />
      ) : null}
    </div>
  );
}
