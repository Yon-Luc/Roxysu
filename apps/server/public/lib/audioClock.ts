/**
 * High-resolution media clock.
 *
 * HTMLMediaElement.currentTime updates in coarse steps (often 20–50ms), which
 * makes scrollers look stuttery even when canvas paints at 144Hz. This clock
 * samples the media time when it changes and interpolates with performance.now()
 * between samples, while staying locked to playbackRate / pause / seek.
 *
 * A seek (`set` to a new position) locks out raw samples that have not arrived
 * at that position yet, so a stale `currentTime` cannot pull the playfield
 * backward and then forward. While playing, a sample that merely lags the
 * interpolator does not rewind it either. Pausing freezes the interpolated
 * time, and resuming continues from that frozen time once the media pointer
 * actually moves — a lagging sample never becomes the drawn position.
 */
/** A media sample this far from the interpolator is treated as a real discontinuity. */
const SEEK_SNAP_MS = 250;
/** Resume holds the frozen position at most this long before advancing again. */
const RESUME_HOLD_MS = 250;
/** How long a `set()` keeps rejecting samples that are still at the old time. */
const SEEK_LOCK_MS = 400;
/** A sample this close to the seek target has arrived (about one audio frame). */
const SEEK_ARRIVE_MS = 50;
/** Smaller than this, `set()` is a rebase and does not arm a seek lock. */
const SEEK_LOCK_EPSILON_MS = 0.5;

export class AudioClock {
  private mediaMs = 0;
  private samplePerfMs = 0;
  private lastRawMediaMs = Number.NaN;
  private rate = 1;
  private playing = false;
  /**
   * Resume hold: `play` fires before audio actually starts, and the media
   * clock can still sit where it was (a step behind the interpolated time) or
   * step back briefly while the pipeline restarts. Stay on the frozen
   * position until that pointer moves, then interpolate forward from it.
   */
  private holding = false;
  private holdUntilNowMs = 0;
  /** Media sample observed on the pause → play edge. Forward motion ends the hold. */
  private resumeRawMs = Number.NaN;
  /** `set()` target. Samples outside {@link SEEK_ARRIVE_MS} are stale until the lock ends. */
  private seekTarget = 0;
  private seekLockUntil = 0;

  /** Force position (seek, pause freeze, track change). */
  set(
    mediaMs: number,
    opts?: { playing?: boolean; rate?: number; now?: number },
  ): void {
    const now = opts?.now ?? performance.now();
    const prev = this.nowMs(now);
    this.mediaMs = mediaMs;
    this.samplePerfMs = now;
    this.lastRawMediaMs = mediaMs;
    this.holding = false;
    if (opts?.playing != null) this.playing = opts.playing;
    if (opts?.rate != null) this.rate = Math.max(0.01, opts.rate);
    // Rebasing onto the current presentation time (embed live-sync glide)
    // must not start a lock. A real jump does, so rAF can keep sampling the
    // pre-seek currentTime without rewinding the notes.
    if (Math.abs(mediaMs - prev) > SEEK_LOCK_EPSILON_MS) {
      this.seekTarget = mediaMs;
      this.seekLockUntil = now + SEEK_LOCK_MS;
    }
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
        // Resume: the pause branch already froze the interpolated time into
        // mediaMs. Wait for the media pointer to actually move before
        // advancing, and never adopt a sample that is still behind it.
        this.holding = true;
        this.holdUntilNowMs = now + RESUME_HOLD_MS;
        this.resumeRawMs = Number.isFinite(rawMediaMs) ? rawMediaMs : Number.NaN;
      } else {
        // Pause: freeze at the interpolated time. The next coarse media sample
        // is usually behind it and must not pull the position back.
        this.holding = false;
        this.mediaMs = this.nowMs(now);
        this.samplePerfMs = now;
      }
      this.playing = opts.playing;
    }

    if (!Number.isFinite(rawMediaMs)) return;

    // In-flight seek: the element is still reporting the pre-seek time (or a
    // timeupdate queued before the seek). Ignore it for the whole lock, even
    // after one sample has already landed on the target.
    if (
      now < this.seekLockUntil &&
      Math.abs(rawMediaMs - this.seekTarget) > SEEK_ARRIVE_MS
    ) {
      return;
    }

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
      const moved =
        Number.isFinite(this.resumeRawMs) &&
        rawMediaMs > this.resumeRawMs + SEEK_LOCK_EPSILON_MS;
      const caughtUp = rawMediaMs >= this.mediaMs;
      if (moved || caughtUp || now >= this.holdUntilNowMs) {
        this.holding = false;
        // Caught up or ahead: take the sample. Still behind: keep the frozen
        // presentation time and start interpolating from it.
        if (caughtUp) this.mediaMs = rawMediaMs;
        this.samplePerfMs = now;
        this.lastRawMediaMs = rawMediaMs;
      }
      return;
    }

    if (rawMediaMs === this.lastRawMediaMs) return;

    const predicted = this.mediaMs + (now - this.samplePerfMs) * this.rate;
    const delta = rawMediaMs - predicted;
    this.lastRawMediaMs = rawMediaMs;
    if (Math.abs(delta) > SEEK_SNAP_MS || delta > 0) {
      // Real discontinuity, or the media clock is a little ahead of us.
      // A sample merely behind the interpolator is the coarse clock lagging;
      // snapping to it is the back-and-forth on the playfield.
      this.mediaMs = rawMediaMs;
      this.samplePerfMs = now;
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
