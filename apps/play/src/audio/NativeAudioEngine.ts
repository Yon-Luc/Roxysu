import type { AudioEngine } from "./AudioEngine";
import {
  createNativeAudioPlayer,
  isNativeAudioAvailable,
} from "../integrations/miniaudio";
import type { NativeAudioPlayer } from "../integrations/miniaudio";

/**
 * Native audio playback via miniaudio_node (rodio backend).
 * Falls back to performance.now() timing when prepareEmpty() is used.
 */
export class NativeAudioEngine implements AudioEngine {
  private player: NativeAudioPlayer | null = null;
  private timelineOnly = false;
  private loaded = false;
  private playing = false;
  private volume = 1;
  private anchorPerf = 0;
  private offsetMs = 0;

  async load(path: string): Promise<void> {
    if (!isNativeAudioAvailable()) {
      throw new Error("Native audio is not available on this platform");
    }

    const file = Bun.file(path);
    if (!(await file.exists())) {
      throw new Error(`Audio file not found: ${path}`);
    }

    this.disposePlayer();
    const player = createNativeAudioPlayer();
    if (!player) {
      throw new Error("Native audio player could not be created");
    }

    player.loadFile(path);
    player.setVolume(this.volume);
    this.player = player;
    this.timelineOnly = false;
    this.loaded = true;
    this.playing = false;
    this.offsetMs = 0;
  }

  prepareEmpty(): void {
    this.disposePlayer();
    this.timelineOnly = true;
    this.loaded = true;
    this.offsetMs = 0;
    this.playing = false;
  }

  play(): void {
    if (!this.loaded) return;

    if (this.player) {
      this.player.play();
      this.playing = true;
      return;
    }

    if (!this.timelineOnly) return;
    this.anchorPerf = performance.now();
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) return;

    if (this.player) {
      this.player.pause();
      this.playing = false;
      return;
    }

    this.offsetMs = this.getPosition();
    this.playing = false;
  }

  stop(): void {
    if (this.player) {
      this.player.stop();
    }
    this.playing = false;
    this.offsetMs = 0;
  }

  seek(ms: number): void {
    const clamped = Math.max(0, ms);
    if (this.player) {
      this.player.seekTo(clamped / 1000);
      return;
    }

    this.offsetMs = clamped;
    if (this.playing) {
      this.anchorPerf = performance.now();
    }
  }

  getPosition(): number {
    if (this.player) {
      return this.player.getCurrentTime() * 1000;
    }

    if (!this.playing) {
      return this.offsetMs;
    }
    return this.offsetMs + (performance.now() - this.anchorPerf);
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.player?.setVolume(this.volume);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  dispose(): void {
    this.disposePlayer();
    this.loaded = false;
    this.playing = false;
    this.offsetMs = 0;
    this.timelineOnly = false;
  }

  private disposePlayer(): void {
    if (!this.player) return;
    try {
      this.player.stop();
    } catch {
      // Player may already be stopped.
    }
    this.player = null;
  }
}
