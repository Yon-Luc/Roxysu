import { describe, expect, test } from "bun:test";
import { boxResize, decodePng, encodePng } from "./pngShrink";

/** Build a tiny valid RGBA PNG via the encoder itself. */
function makeRgba(w: number, h: number) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      data[o] = (x * 255) / Math.max(1, w - 1);
      data[o + 1] = (y * 255) / Math.max(1, h - 1);
      data[o + 2] = 128;
      data[o + 3] = x < w / 2 ? 255 : 0;
    }
  }
  return { width: w, height: h, data };
}

describe("pngShrink", () => {
  test("encode → decode roundtrips dimensions and pixels", () => {
    const src = makeRgba(8, 8);
    const encoded = encodePng(src);
    expect(encoded[0]).toBe(0x89);
    const decoded = decodePng(encoded);
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
    // Opaque pixel survives exactly.
    expect(decoded.data[0]).toBe(src.data[0]);
    expect(decoded.data[3]).toBe(255);
    // Transparent pixel stays transparent.
    const transparent = decoded.data[(4 * 8 + 7) * 4 + 3];
    expect(transparent).toBe(0);
  });

  test("boxResize downscales with alpha weighting", () => {
    const src = makeRgba(64, 64);
    const out = boxResize(src, 8, 8);
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
    // 64→8 maps 8 source px per target px; the opaque/transparent boundary
    // sits exactly between target cols 3 and 4.
    expect(out.data[3 * 4 + 3]).toBe(255);
    expect(out.data[4 * 4 + 3]).toBe(0);
    const mid = makeRgba(64, 64);
    // Shift the boundary into a column: alpha gradient across col 3.
    for (let x = 0; x < 64; x += 1) {
      for (let y = 0; y < 64; y += 1) {
        mid.data[(y * 64 + x) * 4 + 3] = x < 30 ? 255 : x < 34 ? 128 : 0;
      }
    }
    const mixed = boxResize(mid, 8, 8);
    const col3Alpha = mixed.data[3 * 4 + 3];
    expect(col3Alpha).toBeGreaterThan(0);
    expect(col3Alpha).toBeLessThan(255);
  });
});
