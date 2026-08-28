import type { GameClock } from "../game/GameClock";
import type { AudioEngine } from "./AudioEngine";

export class AudioClock implements GameClock {
  constructor(private readonly audio: AudioEngine) {}

  getTime(): number {
    return this.audio.getPosition();
  }

  start(): void {
    this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  resume(): void {
    this.audio.play();
  }

  seek(timeMs: number): void {
    this.audio.seek(timeMs);
  }

  isRunning(): boolean {
    return this.audio.isLoaded();
  }
}
