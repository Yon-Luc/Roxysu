import { NoteType } from "../beatmap/BeatmapChart";
import { createEmptyPlayfieldChart } from "./PlayfieldChart";
import { clipToPlayfield, PlayfieldGeometry } from "./PlayfieldGeometry";
import { PlayfieldTiming } from "./PlayfieldTiming";
import { findVisibleNoteRange } from "./PlayfieldVisibility";
import type {
  PlayfieldChart,
  PlayfieldRendererOptions,
  PlayfieldRenderSnapshot,
} from "./PlayfieldTypes";

const MAX_VISIBLE = 4096;

function computeMaxHoldSpanMs(chart: PlayfieldChart): number {
  let maxSpan = 0;
  for (let i = 0; i < chart.noteCount; i += 1) {
    if (chart.type[i] !== NoteType.Hold) continue;
    const span = chart.endTime[i]! - chart.startTime[i]!;
    if (span > maxSpan) maxSpan = span;
  }
  return maxSpan;
}

export class PlayfieldRenderer {
  private chart: PlayfieldChart = createEmptyPlayfieldChart();
  private readonly timing = new PlayfieldTiming();
  private readonly geometry: PlayfieldGeometry;
  private width: number;
  private height: number;
  private lanes: number;

  private readonly visibleLane = new Uint8Array(MAX_VISIBLE);
  private readonly visibleY = new Float64Array(MAX_VISIBLE);
  private readonly visibleHeight = new Float32Array(MAX_VISIBLE);
  private readonly visibleAlpha = new Float32Array(MAX_VISIBLE);
  private visibleCount = 0;
  private hidden = new Uint8Array(0);
  private maxHoldSpanMs = 0;

  constructor(options: PlayfieldRendererOptions) {
    this.lanes = options.lanes;
    this.width = options.width;
    this.height = options.height;
    const receptorY = options.receptorY ?? this.height - 55;
    this.geometry = new PlayfieldGeometry(receptorY);
    if (options.scrollSpeed != null) {
      this.timing.setScrollSpeed(options.scrollSpeed);
    }
  }

  loadChart(chart: PlayfieldChart): void {
    this.chart = chart;
    this.hidden = new Uint8Array(chart.noteCount);
    this.maxHoldSpanMs = computeMaxHoldSpanMs(chart);
    this.visibleCount = 0;
  }

  setHiddenMask(hidden: Uint8Array): void {
    if (this.hidden.length !== hidden.length) {
      this.hidden = new Uint8Array(hidden.length);
    }
    this.hidden.set(hidden);
  }

  setSongTime(timeMs: number): void {
    this.timing.setSongTime(timeMs);
    this.update();
  }

  setPlaying(playing: boolean): void {
    this.timing.setPlaying(playing);
  }

  setScrollSpeed(speed: number): void {
    this.timing.setScrollSpeed(speed);
    this.update();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.geometry.setReceptorY(height - 55);
    this.update();
  }

  update(): void {
    const { chart } = this;
    this.visibleCount = 0;

    if (chart.noteCount === 0) {
      return;
    }

    const songTimeMs = this.timing.getSongTime();
    const pixelsPerMs = this.timing.pixelsPerMs();
    const receptorY = this.geometry.getReceptorY();
    const lookAheadMs = receptorY / pixelsPerMs + 250;
    const lookBehindMs = (this.height - receptorY) / pixelsPerMs + 250;

    const { begin, end } = findVisibleNoteRange(
      chart.startTime,
      songTimeMs,
      lookAheadMs,
      lookBehindMs,
      this.maxHoldSpanMs,
    );

    for (let i = begin; i < end && this.visibleCount < MAX_VISIBLE; i += 1) {
      const startMs = chart.startTime[i]!;
      const endMs = chart.endTime[i]!;
      if (endMs < songTimeMs - lookBehindMs) {
        continue;
      }

      if (this.hidden[i] === 1) {
        continue;
      }

      const isHold = chart.type[i] === NoteType.Hold;

      const bounds = isHold
        ? this.geometry.hold(startMs, endMs, songTimeMs, pixelsPerMs)
        : this.geometry.tap(startMs, songTimeMs, pixelsPerMs);

      const clipped = clipToPlayfield(bounds.top, bounds.height, receptorY);
      if (!clipped) {
        continue;
      }

      const index = this.visibleCount;
      this.visibleLane[index] = chart.lane[i]!;
      this.visibleY[index] = clipped.top;
      this.visibleHeight[index] = clipped.height;
      this.visibleAlpha[index] = 1;
      this.visibleCount += 1;
    }
  }

  getSnapshot(): PlayfieldRenderSnapshot {
    return {
      visibleCount: this.visibleCount,
      lane: this.visibleLane,
      y: this.visibleY,
      noteHeight: this.visibleHeight,
      alpha: this.visibleAlpha,
      lanes: this.lanes,
      width: this.width,
      playfieldHeight: this.height,
      receptorY: this.geometry.getReceptorY(),
      laneWidth: this.width / this.lanes,
    };
  }

  destroy(): void {
    this.chart = createEmptyPlayfieldChart();
    this.visibleCount = 0;
  }
}
