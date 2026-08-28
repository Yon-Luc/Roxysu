export type PlaySettings = {
  /** Playfield scroll speed in pixels per second. */
  scrollSpeed: number;
  /** Master output volume from 0 to 1. */
  masterVolume: number;
  /** Pre-play countdown duration in seconds. */
  countdownSeconds: number;
  /** User calibration offset added to the audio clock (milliseconds). */
  userOffsetMs: number;
};

export const DEFAULT_PLAY_SETTINGS: PlaySettings = {
  scrollSpeed: 400,
  masterVolume: 0.85,
  countdownSeconds: 3,
  userOffsetMs: 0,
};

export function clampPlaySettings(settings: PlaySettings): PlaySettings {
  return {
    scrollSpeed: Math.max(100, Math.min(1200, settings.scrollSpeed)),
    masterVolume: Math.max(0, Math.min(1, settings.masterVolume)),
    countdownSeconds: Math.max(0, Math.min(10, settings.countdownSeconds)),
    userOffsetMs: Math.max(-500, Math.min(500, settings.userOffsetMs)),
  };
}
