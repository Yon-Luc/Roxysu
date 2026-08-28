export type GameLoopTick = (deltaMs: number, timeMs: number) => void;

const TARGET_HZ = 240;
const FRAME_MS = 1000 / TARGET_HZ;

export class GameLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTickMs = 0;
  private readonly ticks: GameLoopTick[] = [];

  addTick(tick: GameLoopTick): () => void {
    this.ticks.push(tick);
    return () => {
      const index = this.ticks.indexOf(tick);
      if (index >= 0) {
        this.ticks.splice(index, 1);
      }
    };
  }

  start(): void {
    if (this.timer != null) return;
    this.lastTickMs = performance.now();
    this.timer = setInterval(() => this.step(), FRAME_MS);
  }

  stop(): void {
    if (this.timer == null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  isRunning(): boolean {
    return this.timer != null;
  }

  private step(): void {
    const now = performance.now();
    const deltaMs = now - this.lastTickMs;
    this.lastTickMs = now;

    for (const tick of this.ticks) {
      tick(deltaMs, now);
    }
  }
}
