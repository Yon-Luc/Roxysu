/**
 * High-resolution media clock.
 *
 * HTMLMediaElement.currentTime updates in coarse steps (often 20–50ms), which
 * makes scrollers look stuttery even when canvas paints at 144Hz. This clock
 * samples the media time when it changes and interpolates with performance.now()
 * between samples, while staying locked to playbackRate / pause / seek.
 */
export class AudioClock {
  private mediaMs = 0;
  private samplePerfMs = 0;
  private lastRawMediaMs = Number.NaN;
  private rate = 1;
  private playing = false;

  /** Force position (seek, pause freeze, track change). */
  set(
    mediaMs: number,
    opts?: { playing?: boolean; rate?: number; now?: number },
  ): void {
    const now = opts?.now ?? performance.now();
    this.mediaMs = mediaMs;
    this.samplePerfMs = now;
    this.lastRawMediaMs = mediaMs;
    if (opts?.playing != null) this.playing = opts.playing;
    if (opts?.rate != null) this.rate = Math.max(0.01, opts.rate);
  }

  /**
   * Feed the latest media time (ms). Resyncs when the media clock advances
   * or jumps; otherwise leaves the interpolator running.
   */
  observe(
    rawMediaMs: number,
    opts?: { playing?: boolean; rate?: number; now?: number },
  ): void {
    const now = opts?.now ?? performance.now();

    if (opts?.rate != null && opts.rate !== this.rate) {
      this.mediaMs = this.nowMs(now);
      this.samplePerfMs = now;
      this.rate = Math.max(0.01, opts.rate);
    }

    if (opts?.playing != null && opts.playing !== this.playing) {
      if (opts.playing) {
        // Start interpolating from the latest media sample.
        this.mediaMs = Number.isFinite(rawMediaMs) ? rawMediaMs : this.mediaMs;
        this.samplePerfMs = now;
        this.lastRawMediaMs = this.mediaMs;
      } else {
        // Freeze at current interpolated time, then snap to media if present.
        this.mediaMs = Number.isFinite(rawMediaMs)
          ? rawMediaMs
          : this.nowMs(now);
        this.samplePerfMs = now;
        this.lastRawMediaMs = this.mediaMs;
      }
      this.playing = opts.playing;
    }

    if (!Number.isFinite(rawMediaMs)) return;

    if (!this.playing) {
      this.mediaMs = rawMediaMs;
      this.samplePerfMs = now;
      this.lastRawMediaMs = rawMediaMs;
      return;
    }

    // Coarse media clock ticked or seeked — take the new truth.
    if (rawMediaMs !== this.lastRawMediaMs) {
      this.mediaMs = rawMediaMs;
      this.samplePerfMs = now;
      this.lastRawMediaMs = rawMediaMs;
    }
  }

  nowMs(now = performance.now()): number {
    if (!this.playing) return this.mediaMs;
    return this.mediaMs + (now - this.samplePerfMs) * this.rate;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get playbackRate(): number {
    return this.rate;
  }
}

/** Sample an audio element into the clock and return interpolated map time (ms). */
export function sampleAudioClock(
  clock: AudioClock,
  audio: HTMLMediaElement | null | undefined,
  fallbackMs = 0,
): number {
  if (!audio || !Number.isFinite(audio.currentTime)) {
    return clock.nowMs();
  }
  clock.observe(audio.currentTime * 1000, {
    playing: !audio.paused && !audio.ended,
    rate: audio.playbackRate > 0 ? audio.playbackRate : 1,
  });
  const t = clock.nowMs();
  return Number.isFinite(t) ? t : fallbackMs;
}
