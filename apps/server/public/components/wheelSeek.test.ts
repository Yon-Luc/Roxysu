import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SKIP_MS } from "./previewPrefs";
import {
  bindWheelSeek,
  WHEEL_SEEK_MS,
  wheelSeekDeltaMs,
} from "./wheelSeek";

const rafQueue: Array<() => void> = [];
const savedRaf = (globalThis as { requestAnimationFrame?: unknown })
  .requestAnimationFrame;
const savedCancelRaf = (globalThis as { cancelAnimationFrame?: unknown })
  .cancelAnimationFrame;
/** bun has no DOM: a stand-in so `target instanceof Element` works. */
const installedElement = (globalThis as { Element?: unknown }).Element;

beforeEach(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    cb: () => void,
  ) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  if ((globalThis as { Element?: unknown }).Element == null) {
    (globalThis as { Element?: unknown }).Element = class StubElement {};
  }
});

afterEach(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    savedRaf;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame =
    savedCancelRaf;
  (globalThis as { Element?: unknown }).Element = installedElement;
  rafQueue.length = 0;
});

describe("wheelSeekDeltaMs", () => {
  test("one pixel notch seeks 250ms, wheel down is later", () => {
    expect(
      wheelSeekDeltaMs({ deltaY: 100, deltaMode: 0, shiftKey: false }),
    ).toBe(WHEEL_SEEK_MS);
    expect(
      wheelSeekDeltaMs({ deltaY: -100, deltaMode: 0, shiftKey: false }),
    ).toBe(-WHEEL_SEEK_MS);
  });

  test("trackpad pixels scale instead of jumping a full notch", () => {
    expect(
      wheelSeekDeltaMs({ deltaY: 40, deltaMode: 0, shiftKey: false }),
    ).toBe(WHEEL_SEEK_MS * 0.4);
  });

  test("shift uses the same step as the skip buttons", () => {
    expect(
      wheelSeekDeltaMs({ deltaY: 100, deltaMode: 0, shiftKey: true }),
    ).toBe(SKIP_MS);
    expect(
      wheelSeekDeltaMs({ deltaY: -100, deltaMode: 0, shiftKey: true }),
    ).toBe(-SKIP_MS);
  });

  test("Firefox line mode: 3 lines make one notch", () => {
    expect(
      wheelSeekDeltaMs({ deltaY: 3, deltaMode: 1, shiftKey: false }),
    ).toBe(WHEEL_SEEK_MS);
    expect(
      wheelSeekDeltaMs({ deltaY: -3, deltaMode: 1, shiftKey: false }),
    ).toBe(-WHEEL_SEEK_MS);
    // Fractional lines (trackpads in line mode) scale like pixels do.
    expect(
      wheelSeekDeltaMs({ deltaY: 1.5, deltaMode: 1, shiftKey: false }),
    ).toBe(WHEEL_SEEK_MS * 0.5);
    expect(
      wheelSeekDeltaMs({ deltaY: 3, deltaMode: 1, shiftKey: true }),
    ).toBe(SKIP_MS);
  });

  test("page mode is four notches per page", () => {
    expect(
      wheelSeekDeltaMs({ deltaY: 1, deltaMode: 2, shiftKey: false }),
    ).toBe(WHEEL_SEEK_MS * 4);
    expect(
      wheelSeekDeltaMs({ deltaY: -2, deltaMode: 2, shiftKey: false }),
    ).toBe(-WHEEL_SEEK_MS * 8);
  });
});

describe("bindWheelSeek", () => {
  class FakeElement {
    listeners = new Map<string, Set<(e: unknown) => void>>();
    closestSelector: string | null = null;
    seekByCalls: number[] = [];
    allowed = true;
    beforeSeekCalls = 0;
    preventDefaultCalls = 0;
    rafCallbacks: Array<() => void> = [];

    addEventListener(type: string, fn: (e: unknown) => void) {
      const set = this.listeners.get(type) ?? new Set();
      set.add(fn);
      this.listeners.set(type, set);
    }

    removeEventListener(type: string, fn: (e: unknown) => void) {
      this.listeners.get(type)?.delete(fn);
    }

    dispatch(type: string, event: Record<string, unknown>) {
      for (const fn of this.listeners.get(type) ?? []) fn(event);
    }

    closest() {
      return this.closestSelector;
    }
  }

  function flushRaf() {
    const queue = rafQueue.splice(0, rafQueue.length);
    for (const cb of queue) cb();
  }

  test("deltas in one frame coalesce into a single seek", () => {
    const stage = new FakeElement();
    const seekBy: number[] = [];
    bindWheelSeek(stage as unknown as HTMLElement, {
      seekBy: (ms) => seekBy.push(ms),
      beforeSeek: () => {},
    });
    const noOp = () => {};
    stage.dispatch("wheel", {
      deltaY: 100,
      deltaMode: 0,
      ctrlKey: false,
      preventDefault: noOp,
    });
    stage.dispatch("wheel", {
      deltaY: 50,
      deltaMode: 0,
      ctrlKey: false,
      preventDefault: noOp,
    });
    expect(seekBy).toEqual([]);
    flushRaf();
    expect(seekBy).toEqual([WHEEL_SEEK_MS * 1.5]);
  });

  test("ctrl/meta pinch-zoom and disallowed events never seek", () => {
    const stage = new FakeElement();
    const seekBy: number[] = [];
    bindWheelSeek(stage as unknown as HTMLElement, {
      seekBy: (ms) => seekBy.push(ms),
      allow: () => false,
    });
    stage.dispatch("wheel", { deltaY: 100, deltaMode: 0, ctrlKey: false });
    flushRaf();
    expect(seekBy).toEqual([]);
  });

  test("ctrl-wheel stays with the browser zoom", () => {
    const stage = new FakeElement();
    const seekBy: number[] = [];
    bindWheelSeek(stage as unknown as HTMLElement, {
      seekBy: (ms) => seekBy.push(ms),
    });
    stage.dispatch("wheel", { deltaY: 100, deltaMode: 0, ctrlKey: true });
    stage.dispatch("wheel", { deltaY: 100, deltaMode: 0, metaKey: true });
    flushRaf();
    expect(seekBy).toEqual([]);
  });

  test("events on ignored ancestors keep their own wheel behavior", () => {
    // wheelSeekIgnoredTarget needs `target instanceof Element` plus a
    // closest() chain: emulate both with a stubbed Element.
    class FakeTarget {
      closest() {
        return { tag: "button" };
      }
    }
    const savedElement = (globalThis as { Element?: unknown }).Element;
    (globalThis as { Element?: unknown }).Element = FakeTarget;
    try {
      const stage = new FakeElement();
      const seekBy: number[] = [];
      bindWheelSeek(stage as unknown as HTMLElement, {
        seekBy: (ms) => seekBy.push(ms),
      });
      stage.dispatch("wheel", {
        deltaY: 100,
        deltaMode: 0,
        target: new FakeTarget(),
      });
      flushRaf();
      expect(seekBy).toEqual([]);
    } finally {
      (globalThis as { Element?: unknown }).Element = savedElement;
    }
  });

  test("preventDefault runs only for seeking events", () => {
    const stage = new FakeElement();
    bindWheelSeek(stage as unknown as HTMLElement, {
      seekBy: () => {},
    });
    let prevented = 0;
    stage.dispatch("wheel", {
      deltaY: 100,
      deltaMode: 0,
      preventDefault: () => {
        prevented += 1;
      },
    });
    stage.dispatch("wheel", {
      deltaY: 0,
      deltaMode: 0,
      preventDefault: () => {
        prevented += 1;
      },
    });
    flushRaf();
    expect(prevented).toBe(1);
  });
});
