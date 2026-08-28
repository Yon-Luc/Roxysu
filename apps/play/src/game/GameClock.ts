export interface GameClock {
  getTime(): number;
  start(): void;
  pause(): void;
  resume(): void;
  seek(timeMs: number): void;
  isRunning(): boolean;
}

/**
 * Monotonic gameplay clock. Audio will become authoritative later; for M1 this
 * uses high-resolution wall time.
 */
export class WallClock implements GameClock {
  private anchorMs = 0;
  private offsetMs = 0;
  private running = false;

  getTime(): number {
    if (!this.running) {
      return this.offsetMs;
    }
    return this.offsetMs + (performance.now() - this.anchorMs);
  }

  start(): void {
    this.offsetMs = 0;
    this.anchorMs = performance.now();
    this.running = true;
  }

  pause(): void {
    if (!this.running) return;
    this.offsetMs = this.getTime();
    this.running = false;
  }

  resume(): void {
    if (this.running) return;
    this.anchorMs = performance.now();
    this.running = true;
  }

  seek(timeMs: number): void {
    this.offsetMs = Math.max(0, timeMs);
    if (this.running) {
      this.anchorMs = performance.now();
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
