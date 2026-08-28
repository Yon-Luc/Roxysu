export interface AudioEngine {
  load(path: string): Promise<void>;
  play(): void;
  pause(): void;
  stop(): void;
  seek(ms: number): void;
  getPosition(): number;
  setVolume(value: number): void;
  isLoaded(): boolean;
}
