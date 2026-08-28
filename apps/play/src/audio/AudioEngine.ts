export interface AudioEngine {
  load(path: string): Promise<void>;
  /** Enable timeline tracking when a map has no audio file. */
  prepareEmpty(): void;
  play(): void;
  pause(): void;
  stop(): void;
  seek(ms: number): void;
  getPosition(): number;
  setVolume(value: number): void;
  isLoaded(): boolean;
  dispose(): void;
}
