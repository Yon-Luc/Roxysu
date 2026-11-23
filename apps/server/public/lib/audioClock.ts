/**
 * High-resolution media clock.
 *
 * HTMLMediaElement.currentTime updates in coarse steps (often 20–50ms), which
 * makes scrollers look stuttery even when canvas paints at 144Hz. This clock
 * samples the media time when it changes and interpolates with performance.now()
 * between samples, while staying locked to playbackRate / pause / seek.
 *
 * A seek (`set` to a new position) locks out raw samples until one lands near
 * the target (short grace after arrival, {@link SEEK_LOCK_MAX_MS} ceiling when
 * nothing has arrived yet), so a stale `currentTime` cannot pull the playfield
 * backward and then forward — even when the element takes a while to land.
 * While playing, a sample that lags the interpolator by less than one coarse
 * step is clock granularity and is ignored; a persistent larger lag is closed
 * gradually (slewed) instead of sitting until it exceeds the snap threshold.
 * Pausing freezes the interpolated time and arms a short lock so a lagging
 * paused sample cannot snap the frozen position, and resuming continues from
 * that frozen time once the media pointer actually moves — a lagging sample
 * never becomes the drawn position.
 */
/** A media sample this far from the interpolator is treated as a real discontinuity. */
const SEEK_SNAP_MS = 250;
/** Resume holds the frozen position at most this long before advancing again. */
const RESUME_HOLD_MS = 250;
/**
 * Grace after a seek sample has arrived near the target: a stale timeupdate
 * from before the seek is still rejected, but the lock no longer outlives a
 * landed seek.
 */
const SEEK_LOCK_MS = 400;
/**
 * Ceiling a `set()` seek lock can run without any sample near the target.
 * A seek that lands slowly (large file, long jump, cold cache) must not have
 * its still-old `currentTime` treated as a real discontinuity after 400ms.
 * Shared with the React seek guards — import this instead of re-hard-coding.
 */
export const SEEK_LOCK_MAX_MS = 1500;
/** A sample this close to the seek target has arrived (about one audio frame). */
const SEEK_ARRIVE_MS = 50;
/** Smaller than this, `set()` is a rebase and does not arm a seek lock. */
const SEEK_LOCK_EPSILON_MS = 0.5;
/**
 * Lag within one coarse media step (currentTime often ticks 20–50ms) is clock
 * granularity, not drift — ignore it exactly like a repeated sample.
 */
const COARSE_TICK_MS = 60;
/** Share of a persistent lag (between one coarse step and the snap threshold) a single sample closes. */
const LAG_SLEW = 0.25;

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
    const wasPlaying = this.playing;
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
      this.seekLockUntil = now + SEEK_LOCK_MAX_MS;
    } else if (opts?.playing === false && wasPlaying) {
      // Pause-freeze at the interpolated position: while the element still
      // reports a lagging time (live sync can leave it seconds behind), the
      // frozen position is the position to hold — reject such samples for a
      // short grace instead of snapping back to them.
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
        // The frozen position is protected like a seek target for a short
        // grace: a paused sample seconds behind (live-sync hold) must not
        // snap the playfield back while the freeze settles.
        this.seekTarget = this.mediaMs;
        this.seekLockUntil = now + SEEK_LOCK_MS;
      }
      this.playing = opts.playing;
    }

    if (!Number.isFinite(rawMediaMs)) return;

    // In-flight seek: the element is still reporting the pre-seek time (or a
    // timeupdate queued before the seek). Ignore it until a sample has
    // arrived near the target, then keep only a short grace — a late stale
    // timeupdate is still rejected, but the lock no longer outlives a seek
    // that landed. With no arrival at all the lock ends at the ceiling.
    if (now < this.seekLockUntil) {
      if (Math.abs(rawMediaMs - this.seekTarget) > SEEK_ARRIVE_MS) {
        return;
      }
      this.seekLockUntil = Math.min(this.seekLockUntil, now + SEEK_LOCK_MS);
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
    if (delta > 0 || Math.abs(delta) > SEEK_SNAP_MS) {
      // Real discontinuity, or the media clock is a little ahead of us.
      // A sample merely behind the interpolator is the coarse clock lagging;
      // snapping to it is the back-and-forth on the playfield.
      this.mediaMs = rawMediaMs;
      this.samplePerfMs = now;
    } else if (delta < -COARSE_TICK_MS) {
      // Persistent lag larger than one coarse step but under the snap
      // threshold: close a fraction of the gap per sample so drift cannot
      // accumulate until it jumps as a 250ms discontinuity. The correction
      // is a few tens of ms per step — far below a visible snap.
      this.mediaMs = predicted + delta * LAG_SLEW;
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
