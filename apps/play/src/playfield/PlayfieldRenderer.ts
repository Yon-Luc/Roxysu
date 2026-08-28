import { NoteType } from "../beatmap/BeatmapChart";
import { createEmptyPlayfieldChart } from "./PlayfieldChart";
import { PlayfieldGeometry, isNoteVisible } from "./PlayfieldGeometry";
import { PlayfieldTiming } from "./PlayfieldTiming";
import { findVisibleNoteRange } from "./PlayfieldVisibility";
import type {
  PlayfieldChart,
  PlayfieldColumnSnapshot,
  PlayfieldRendererOptions,
  PlayfieldRenderSnapshot,
} from "./PlayfieldTypes";

const MAX_VISIBLE = 512;

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
  private readonly visibleIsHold = new Uint8Array(MAX_VISIBLE);
  private readonly visibleNoteIndex = new Uint32Array(MAX_VISIBLE);
  private visibleCount = 0;
  private hidden = new Uint8Array(0);
  private maxHoldSpanMs = 0;
  private columns: PlayfieldColumnSnapshot[] = [];

  constructor(options: PlayfieldRendererOptions) {
    this.lanes = options.lanes;
    this.width = options.width;
    this.height = options.height;
    const receptorY = options.receptorY ?? this.height - 55;
    this.geometry = new PlayfieldGeometry(receptorY);
    this.resetColumns(options.lanes, options.width);
    if (options.scrollSpeed != null) {
      this.timing.setScrollSpeed(options.scrollSpeed);
    }
  }

  setColumnLayout(columns: readonly PlayfieldColumnSnapshot[]): void {
    this.columns = columns.map((column) => ({ ...column }));
    this.geometry.setColumnTapHeights(columns.map((column) => column.tapHeight));
    if (columns.length > 0) {
      this.geometry.setReceptorY(this.geometry.getReceptorY());
    }
    this.update();
  }

  setReceptorY(receptorY: number): void {
    this.geometry.setReceptorY(receptorY);
    this.update();
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
    this.resetColumns(this.lanes, width);
    this.update();
  }

  private resetColumns(lanes: number, width: number): void {
    const laneWidth = width / Math.max(1, lanes);
    this.columns = Array.from({ length: lanes }, (_, lane) => ({
      x: lane * laneWidth,
      w: laneWidth,
      tapHeight: 18,
    }));
    this.geometry.setColumnTapHeights(this.columns.map((column) => column.tapHeight));
    if (this.columns.length > 0) {
      const fallbackReceptorY = this.height - 55;
      this.geometry.setReceptorY(fallbackReceptorY);
    }
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

      const lane = chart.lane[i]!;
      const isHold = chart.type[i] === NoteType.Hold;

      const bounds = isHold
        ? this.geometry.hold(startMs, endMs, songTimeMs, pixelsPerMs, lane)
        : this.geometry.tap(startMs, songTimeMs, pixelsPerMs, lane);

      if (!isNoteVisible(bounds.top, bounds.height, this.height)) {
        continue;
      }

      const index = this.visibleCount;
      this.visibleLane[index] = lane;
      this.visibleY[index] = bounds.top;
      this.visibleHeight[index] = bounds.height;
      this.visibleIsHold[index] = isHold ? 1 : 0;
      this.visibleNoteIndex[index] = i;
      this.visibleAlpha[index] = 1;
      this.visibleCount += 1;
    }
  }

  getSnapshot(): PlayfieldRenderSnapshot {
    const laneWidth =
      this.columns[0]?.w ?? this.width / Math.max(1, this.lanes);
    return {
      visibleCount: this.visibleCount,
      lane: this.visibleLane,
      y: this.visibleY,
      noteHeight: this.visibleHeight,
      isHold: this.visibleIsHold,
      noteIndex: this.visibleNoteIndex,
      alpha: this.visibleAlpha,
      lanes: this.lanes,
      width: this.width,
      playfieldHeight: this.height,
      receptorY: this.geometry.getReceptorY(),
      columns: this.columns,
      laneWidth,
    };
  }

  destroy(): void {
    this.chart = createEmptyPlayfieldChart();
    this.visibleCount = 0;
  }
}
