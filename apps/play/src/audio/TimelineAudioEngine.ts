import type { AudioEngine } from "./AudioEngine";

/**
 * Timeline-backed audio engine for environments without a native decoder.
 * Tracks song position from performance time; does not emit sound yet.
 */
export class TimelineAudioEngine implements AudioEngine {
  private loaded = false;
  private playing = false;
  private volume = 1;
  private anchorPerf = 0;
  private offsetMs = 0;

  async load(path: string): Promise<void> {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      throw new Error(`Audio file not found: ${path}`);
    }
    this.markTimelineReady();
  }

  /** Enable timeline tracking without decoding audio (M2 fallback). */
  markTimelineReady(): void {
    this.loaded = true;
    this.offsetMs = 0;
    this.playing = false;
  }

  play(): void {
    if (!this.loaded) return;
    this.anchorPerf = performance.now();
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;
    this.offsetMs = this.getPosition();
    this.playing = false;
  }

  stop(): void {
    this.playing = false;
    this.offsetMs = 0;
  }

  seek(ms: number): void {
    this.offsetMs = Math.max(0, ms);
    if (this.playing) {
      this.anchorPerf = performance.now();
    }
  }

  getPosition(): number {
    if (!this.playing) {
      return this.offsetMs;
    }
    return this.offsetMs + (performance.now() - this.anchorPerf);
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}
