import { createEmptyPlayfieldChart } from "./PlayfieldChart";
import { PlayfieldGeometry } from "./PlayfieldGeometry";
import { PlayfieldTiming } from "./PlayfieldTiming";
import { findVisibleRange } from "./PlayfieldVisibility";
import type {
  PlayfieldChart,
  PlayfieldRendererOptions,
  PlayfieldRenderSnapshot,
} from "./PlayfieldTypes";

const MAX_VISIBLE = 4096;

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
    this.visibleCount = 0;
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
    const lookAheadMs = (this.geometry.getReceptorY() / pixelsPerMs) + 500;
    const lookBehindMs =
      ((this.height - this.geometry.getReceptorY()) / pixelsPerMs) + 500;

    const { begin, end } = findVisibleRange(
      chart.startTime,
      songTimeMs,
      lookAheadMs,
      lookBehindMs,
    );

    for (let i = begin; i < end && this.visibleCount < MAX_VISIBLE; i += 1) {
      const startMs = chart.startTime[i]!;
      const endMs = chart.endTime[i]!;
      const y = this.geometry.headY(startMs, songTimeMs, pixelsPerMs);
      const height = this.geometry.height(startMs, endMs, pixelsPerMs);

      if (y + height < -height || y > this.height + height) {
        continue;
      }

      const index = this.visibleCount;
      this.visibleLane[index] = chart.lane[i]!;
      this.visibleY[index] = y;
      this.visibleHeight[index] = height;
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
