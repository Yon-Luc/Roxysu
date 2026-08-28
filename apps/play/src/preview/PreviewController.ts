import type { AudioEngine } from "../audio/AudioEngine";
import { createAudioEngine } from "../audio/createAudioEngine";

const PREVIEW_PREROLL_MS = 1000;

export class PreviewController {
  private readonly audio: AudioEngine;
  private activePath: string | null = null;

  constructor(audio?: AudioEngine) {
    this.audio = audio ?? createAudioEngine();
  }

  get engine(): AudioEngine {
    return this.audio;
  }

  async play(
    audioPath: string,
    previewTimeMs: number | null,
  ): Promise<void> {
    if (this.activePath === audioPath && this.audio.isLoaded()) {
      const seekMs = Math.max(
        0,
        (previewTimeMs ?? 0) - PREVIEW_PREROLL_MS,
      );
      this.audio.seek(seekMs);
      this.audio.play();
      return;
    }

    this.stop();
    await this.audio.load(audioPath);
    const seekMs = Math.max(0, (previewTimeMs ?? 0) - PREVIEW_PREROLL_MS);
    this.audio.seek(seekMs);
    this.audio.play();
    this.activePath = audioPath;
  }

  stop(): void {
    if (!this.audio.isLoaded()) return;
    this.audio.stop();
    this.activePath = null;
  }

  setVolume(volume: number): void {
    this.audio.setVolume(volume);
  }

  dispose(): void {
    this.stop();
    this.audio.dispose();
    this.activePath = null;
  }
}
