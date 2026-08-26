/**
 * PNG logo shrinker for the tosu-counter build. Uses Bun.Image (Bun 1.4) for
 * decode → box-downscale → encode. The box filter is alpha-premultiplied, so
 * semi-transparent edges don't pick up dark halos.
 *
 * `boxResize` is kept as a pure, dependency-free utility for callers that
 * already hold raw RGBA (e.g. a canvas readback); Bun.Image can't expose its
 * pixel buffer, so the shrink path can't reuse it directly.
 */
export type RgbaImage = { width: number; height: number; data: Uint8Array };

/** Alpha-aware box average (premultiplied) to avoid dark halos. */
export function boxResize(
  img: RgbaImage,
  targetW: number,
  targetH: number,
): RgbaImage {
  const out = new Uint8Array(targetW * targetH * 4);
  const sx = img.width / targetW;
  const sy = img.height / targetH;
  for (let ty = 0; ty < targetH; ty += 1) {
    const y0 = Math.floor(ty * sy);
    const y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < targetW; tx += 1) {
      const x0 = Math.floor(tx * sx);
      const x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sx));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < img.height; y += 1) {
        for (let x = x0; x < x1 && x < img.width; x += 1) {
          const o = (y * img.width + x) * 4;
          const alpha = img.data[o + 3]! / 255;
          r += img.data[o]! * alpha;
          g += img.data[o + 1]! * alpha;
          b += img.data[o + 2]! * alpha;
          a += alpha;
          count += 1;
        }
      }
      const o = (ty * targetW + tx) * 4;
      const avgA = count > 0 ? a / count : 0;
      if (avgA > 0.0001) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(avgA * 255);
    }
  }
  return { width: targetW, height: targetH, data: out };
}

export async function shrinkPng(
  bytes: Uint8Array,
  targetW: number,
  targetH: number,
): Promise<Uint8Array> {
  const img = new Bun.Image(bytes).resize(targetW, targetH, {
    filter: "box",
  });
  return await img.png({ compressionLevel: 9 }).bytes();
}
