import { describe, expect, test } from "bun:test";
import { parseOverlayHostUrl } from "./overlayUrl";

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
