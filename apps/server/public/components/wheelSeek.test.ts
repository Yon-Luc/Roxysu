import { describe, expect, test } from "bun:test";
import { SKIP_MS } from "./previewPrefs";
import { WHEEL_SEEK_MS, wheelSeekDeltaMs } from "./wheelSeek";

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

  test("Firefox line mode treats one line as one notch", () => {
    expect(
      wheelSeekDeltaMs({ deltaY: 1, deltaMode: 1, shiftKey: false }),
    ).toBe(WHEEL_SEEK_MS);
    expect(
      wheelSeekDeltaMs({ deltaY: -3, deltaMode: 1, shiftKey: false }),
    ).toBe(-WHEEL_SEEK_MS * 3);
    expect(
      wheelSeekDeltaMs({ deltaY: 1, deltaMode: 1, shiftKey: true }),
    ).toBe(SKIP_MS);
  });
});
