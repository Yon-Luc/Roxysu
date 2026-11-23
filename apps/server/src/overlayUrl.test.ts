import { describe, expect, test } from "bun:test";
import { parseOverlayHostUrl, parseOverlayOutput } from "./overlayUrl";

describe("parseOverlayHostUrl", () => {
  test("keeps a loopback HUD hash URL", () => {
    const raw = "http://127.0.0.1:4321/#/overlay?bg=clear";
    expect(parseOverlayHostUrl(raw)).toEqual({ ok: true, url: raw });
  });

  test("rejects a missing scheme, userinfo, and other protocols", () => {
    expect(parseOverlayHostUrl("127.0.0.1:4321/#/overlay").ok).toBe(false);
    expect(parseOverlayHostUrl("http://user:pass@127.0.0.1/#/overlay").ok).toBe(false);
    expect(parseOverlayHostUrl("file:///tmp/overlay").ok).toBe(false);
  });
});

describe("parseOverlayOutput", () => {
  test("keeps a connector or model", () => {
    expect(parseOverlayOutput(" DP-4 ")).toEqual({ ok: true, output: "DP-4" });
    expect(parseOverlayOutput("ZOWIE XL2546")).toEqual({
      ok: true,
      output: "ZOWIE XL2546",
    });
  });

  test("rejects empty, flags, and control characters", () => {
    expect(parseOverlayOutput("  ").ok).toBe(false);
    expect(parseOverlayOutput("--follow-focus=false").ok).toBe(false);
    expect(parseOverlayOutput("DP-4\n--url=http://evil").ok).toBe(false);
  });
});
