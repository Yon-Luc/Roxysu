import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  OVERLAY_OUTPUT_MAX,
  OVERLAY_URL_MAX,
  parseOverlayHostUrl,
  parseOverlayOutput,
} = require("./overlayUrlGuard.js");

describe("parseOverlayHostUrl (shell mirror of the server parser)", () => {
  test("accepts a plain http HUD URL with a hash route", () => {
    expect(parseOverlayHostUrl("http://127.0.0.1:4321/#/overlay?bg=clear")).toEqual({
      ok: true,
      url: "http://127.0.0.1:4321/#/overlay?bg=clear",
    });
  });

  test("accepts https and trims surrounding spaces", () => {
    expect(parseOverlayHostUrl("  https://example.com/hud  ")).toEqual({
      ok: true,
      url: "https://example.com/hud",
    });
  });

  test("rejects file:// and other schemes", () => {
    expect(parseOverlayHostUrl("file:///etc/passwd").ok).toBe(false);
    expect(parseOverlayHostUrl("ftp://example.com/").ok).toBe(false);
    expect(parseOverlayHostUrl("javascript:alert(1)").ok).toBe(false);
  });

  test("rejects embedded credentials", () => {
    expect(parseOverlayHostUrl("http://user:pass@127.0.0.1:4321/").ok).toBe(false);
    expect(parseOverlayHostUrl("http://user@127.0.0.1:4321/").ok).toBe(false);
  });

  test("rejects garbage and overlong values", () => {
    expect(parseOverlayHostUrl("").ok).toBe(false);
    expect(parseOverlayHostUrl("   ").ok).toBe(false);
    expect(parseOverlayHostUrl("not a url").ok).toBe(false);
    expect(parseOverlayHostUrl(`http://x/${"a".repeat(OVERLAY_URL_MAX)}`).ok).toBe(false);
  });
});

describe("parseOverlayOutput (shell mirror of the server parser)", () => {
  test("accepts connector and model names, including spaces and =", () => {
    expect(parseOverlayOutput("DP-4")).toEqual({ ok: true, output: "DP-4" });
    expect(parseOverlayOutput("ZOWIE XL2546")).toEqual({
      ok: true,
      output: "ZOWIE XL2546",
    });
    // clap keeps '=' inside --output=VALUE; a value must not be split or
    // rejected for containing one.
    expect(parseOutputWithEquals()).toEqual({ ok: true, output: "DP-4=2" });
  });

  test("trims surrounding space", () => {
    expect(parseOverlayOutput("  DP-4  ")).toEqual({ ok: true, output: "DP-4" });
  });

  test("rejects leading dashes (would parse as a flag)", () => {
    expect(parseOverlayOutput("--follow-focus=false").ok).toBe(false);
    expect(parseOverlayOutput("-x").ok).toBe(false);
  });

  test("rejects control characters (embedded argv tricks)", () => {
    expect(parseOverlayOutput("DP-4\n--url=http://evil").ok).toBe(false);
    // A trailing tab is trimmed away (valid, like the server parser); a bell
    // inside the value survives trim and must be rejected.
    expect(parseOverlayOutput("DP-4\u0007").ok).toBe(false);
    expect(parseOverlayOutput("DP-4\u0000").ok).toBe(false);
  });

  test("rejects empty and overlong values", () => {
    expect(parseOverlayOutput("").ok).toBe(false);
    expect(parseOverlayOutput("   ").ok).toBe(false);
    expect(parseOverlayOutput("a".repeat(OVERLAY_OUTPUT_MAX + 1)).ok).toBe(false);
    expect(parseOverlayOutput("a".repeat(OVERLAY_OUTPUT_MAX))).toEqual({
      ok: true,
      output: "a".repeat(OVERLAY_OUTPUT_MAX),
    });
  });
});

function parseOutputWithEquals() {
  return parseOverlayOutput("DP-4=2");
}
