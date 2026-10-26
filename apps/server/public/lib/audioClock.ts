/**
 * High-resolution media clock.
 *
 * HTMLMediaElement.currentTime updates in coarse steps (often 20–50ms), which
 * makes scrollers look stuttery even when canvas paints at 144Hz. This clock
 * samples the media time when it changes and interpolates with performance.now()
 * between samples, while staying locked to playbackRate / pause / seek.
 * Pausing freezes the interpolated time (the next coarse sample usually sits
 * behind it), and resuming holds that position until the media pointer really
 * moves, so the playfield never snaps back on pause or resume.
 */
/** A media sample this far from the current position is treated as a seek. */
const SEEK_SNAP_MS = 250;
/** Resume holds the frozen position at most this long before following media again. */
const RESUME_HOLD_MS = 250;

export class AudioClock {
  private mediaMs = 0;
  private samplePerfMs = 0;
  private lastRawMediaMs = Number.NaN;
  private rate = 1;
  private playing = false;
  /**
   * Resume hold: `play` fires before audio actually starts, and the media
   * clock can still sit where it was (a step behind the interpolated time) or
   * step back briefly while the pipeline restarts. Holding the frozen
   * position instead of interpolating ahead of the sound is what removes the
   * mini rollback on resume.
   */
  private holding = false;
  private holdUntilNowMs = 0;

  /** Force position (seek, pause freeze, track change). */
  set(
    mediaMs: number,
    opts?: { playing?: boolean; rate?: number; now?: number },
  ): void {
    const now = opts?.now ?? performance.now();
    this.mediaMs = mediaMs;
    this.samplePerfMs = now;
    this.lastRawMediaMs = mediaMs;
    this.holding = false;
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
        // Resume: start from the frozen position and wait for the media
        // pointer to actually move. Adopting raw immediately (still stale, or
        // rewound while the pipeline restarts) snapped the playfield backward.
        this.holding = true;
        this.holdUntilNowMs = now + RESUME_HOLD_MS;
        if (Number.isFinite(rawMediaMs)) this.lastRawMediaMs = rawMediaMs;
      } else {
        // Pause: freeze at the interpolated time. The next coarse media sample
        // is usually behind it and must not pull the position back.
        this.holding = false;
        this.mediaMs = this.nowMs(now);
        this.samplePerfMs = now;
        if (Number.isFinite(rawMediaMs)) this.lastRawMediaMs = rawMediaMs;
      }
      this.playing = opts.playing;
    }

    if (!Number.isFinite(rawMediaMs)) return;

    if (!this.playing) {
      // While paused only a real seek (a large jump) moves the position.
      if (rawMediaMs !== this.lastRawMediaMs) {
        this.lastRawMediaMs = rawMediaMs;
        if (Math.abs(rawMediaMs - this.mediaMs) > SEEK_SNAP_MS) {
          this.mediaMs = rawMediaMs;
          this.samplePerfMs = now;
        }
      }
      return;
    }

    if (this.holding) {
      // Stay frozen until the media pointer reaches the held position (the
      // pipeline has really started / caught up) or the hold times out.
      if (rawMediaMs >= this.mediaMs || now >= this.holdUntilNowMs) {
        this.holding = false;
        this.mediaMs = rawMediaMs;
        this.samplePerfMs = now;
        this.lastRawMediaMs = rawMediaMs;
      }
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
    if (!this.playing || this.holding) return this.mediaMs;
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

/**
 * Publish map time into React state without re-rendering the host on every
 * media `timeupdate`. Throttled by default; pass `force` on seek / play /
 * pause / ended so the scrubber snaps immediately.
 */
export function createUiTimePublisher(
  publish: (ms: number) => void,
  minIntervalMs = 100,
): (ms: number, force?: boolean) => void {
  let lastWall = Number.NEGATIVE_INFINITY;
  return (ms: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastWall < minIntervalMs) return;
    lastWall = now;
    publish(ms);
  };
}
