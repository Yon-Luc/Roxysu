import { SKIP_MS } from "./previewPrefs";

/** Pixels in one typical mouse notch (Chromium deltaMode 0). */
const NOTCH_PX = 100;
/** Time moved by one notch without Shift. */
export const WHEEL_SEEK_MS = 250;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/** Ancestors that keep their own wheel behavior (sliders, buttons, analysis list). */
const WHEEL_SEEK_IGNORE = "aside, input, textarea, select, button, a";

export type WheelSeekInput = {
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
};

/**
 * Wheel-down (positive deltaY) seeks later. One pixel-notch is {@link WHEEL_SEEK_MS};
 * Shift uses {@link SKIP_MS}. Line mode counts one line as one notch so Firefox
 * matches a Chromium notch. Page mode is four notches.
 */
export function wheelSeekDeltaMs(e: WheelSeekInput): number {
  let notches: number;
  if (e.deltaMode === DOM_DELTA_LINE) notches = e.deltaY;
  else if (e.deltaMode === DOM_DELTA_PAGE) notches = e.deltaY * 4;
  else notches = e.deltaY / NOTCH_PX;
  return notches * (e.shiftKey ? SKIP_MS : WHEEL_SEEK_MS);
}

export function wheelSeekIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(WHEEL_SEEK_IGNORE) != null;
}

/** Sum wheel deltas in one frame so a trackpad stream seeks audio once. */
export function bindWheelSeek(
  stage: HTMLElement,
  opts: {
    seekBy: (deltaMs: number) => void;
    /** Return false to ignore the event and leave the browser default. */
    allow?: () => boolean;
    beforeSeek?: () => void;
  },
): () => void {
  let pending = 0;
  let raf = 0;

  function flush() {
    raf = 0;
    const delta = pending;
    pending = 0;
    if (delta !== 0) opts.seekBy(delta);
  }

  function onWheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey) return;
    if (opts.allow && !opts.allow()) return;
    if (wheelSeekIgnoredTarget(event.target)) return;
    const delta = wheelSeekDeltaMs(event);
    if (delta === 0) return;
    event.preventDefault();
    opts.beforeSeek?.();
    pending += delta;
    if (raf) return;
    raf = requestAnimationFrame(flush);
  }

  stage.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    stage.removeEventListener("wheel", onWheel);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    pending = 0;
  };
}
