import { describe, expect, test } from "bun:test";
import { parseSettingsFrame } from "./tosuSettings";

describe("parseSettingsFrame", () => {
  test("parses getSettings JSON replies", () => {
    expect(
      parseSettingsFrame(
        { command: "getSettings", message: { scrollSpeed: 24 } },
        "/RoxysuPreview/",
      ),
    ).toEqual({ scrollSpeed: 24 });
  });

  test("ignores error replies and other commands", () => {
    expect(
      parseSettingsFrame(
        { command: "getSettings", message: { error: "Wrong overlay" } },
        "/RoxysuPreview/",
      ),
    ).toBeNull();
    expect(
      parseSettingsFrame(
        { command: "getBeatmapFile", message: {} },
        "/RoxysuPreview/",
      ),
    ).toBeNull();
  });

  test("parses updateSettings broadcast frames (array payload)", () => {
    const frame = `updateSettings:/RoxysuPreview/:${JSON.stringify([
      { uniqueID: "scrollSpeed", value: 30 },
      { uniqueID: "transparentBg", value: true },
    ])}`;
    expect(parseSettingsFrame(frame, "/RoxysuPreview/")).toEqual({
      scrollSpeed: 30,
      transparentBg: true,
    });
  });

  test("parses updateSettings record payloads", () => {
    expect(
      parseSettingsFrame(
        `updateSettings:/RoxysuPreview/:${JSON.stringify({ laneCover: 20 })}`,
        "/RoxysuPreview/",
      ),
    ).toEqual({ laneCover: 20 });
  });

  test("rejects frames for other counters and garbage", () => {
    expect(
      parseSettingsFrame(
        `updateSettings:/Other/:${JSON.stringify([{ uniqueID: "a", value: 1 }])}`,
        "/RoxysuPreview/",
      ),
    ).toBeNull();
    expect(parseSettingsFrame("random text", "/RoxysuPreview/")).toBeNull();
    expect(parseSettingsFrame(null, "/RoxysuPreview/")).toBeNull();
  });
});
