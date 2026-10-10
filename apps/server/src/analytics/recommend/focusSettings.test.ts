import { describe, expect, it } from "bun:test";
import {
  DEFAULT_FOCUS_SETTINGS,
  normalizeFocusSettings,
  parseFocusSettingsJson,
  validateFocusSettingsInput,
} from "./focusSettings";

describe("normalizeFocusSettings", () => {
  it("returns defaults for empty input", () => {
    expect(normalizeFocusSettings(null)).toEqual(DEFAULT_FOCUS_SETTINGS);
  });

  it("clamps inverted push band", () => {
    const next = normalizeFocusSettings({
      push: { accMin: 0.95, accMax: 0.9, targetRatio: 1, tolerance: 0.08 },
    });
    expect(next.push.accMax).toBeGreaterThan(next.push.accMin);
  });
});

describe("validateFocusSettingsInput", () => {
  it("accepts defaults", () => {
    const result = validateFocusSettingsInput(DEFAULT_FOCUS_SETTINGS);
    expect(result.ok).toBe(true);
  });

  it("rejects inverted accuracy band", () => {
    const result = validateFocusSettingsInput({
      ...DEFAULT_FOCUS_SETTINGS,
      accuracy: {
        ...DEFAULT_FOCUS_SETTINGS.accuracy,
        accMin: 0.99,
        accMax: 0.98,
      },
    });
    expect(result.ok).toBe(false);
  });
});

describe("parseFocusSettingsJson", () => {
  it("parses stored JSON", () => {
    const parsed = parseFocusSettingsJson(
      JSON.stringify({
        push: { accMin: 0.91, accMax: 0.94, targetRatio: 1.02, tolerance: 0.05 },
        topPlays: 20,
      }),
    );
    expect(parsed.push.accMin).toBeCloseTo(0.91, 4);
    expect(parsed.topPlays).toBe(20);
    expect(parsed.accuracy.accMin).toBe(DEFAULT_FOCUS_SETTINGS.accuracy.accMin);
  });
});
