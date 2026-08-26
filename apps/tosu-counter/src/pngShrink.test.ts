import { describe, expect, test } from "bun:test";
import { deflateSync, inflateSync } from "node:zlib";
import { boxResize, shrinkPng, type RgbaImage } from "./pngShrink";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i += 1)
    crc = crcTable[(crc ^ out[i]!) & 0xff]! ^ (crc >>> 8);
  dv.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
}
function encodePng(img: RgbaImage): Uint8Array {
  const stride = img.width * 4;
  const raw = new Uint8Array((stride + 1) * img.height);
  for (let y = 0; y < img.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, img.width);
  dv.setUint32(4, img.height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    Buffer.from(chunk("IHDR", ihdr)),
    Buffer.from(chunk("IDAT", deflateSync(raw, { level: 9 }))),
    Buffer.from(chunk("IEND", new Uint8Array(0))),
  ]);
}
function decodeRgba(bytes: Uint8Array): RgbaImage {
  let off = 8;
  let w = 0;
  let h = 0;
  const idat: Uint8Array[] = [];
  while (off + 8 <= bytes.length) {
    const len = Buffer.from(bytes.buffer, bytes.byteOffset + off, 4).readUInt32BE(0);
    const type = String.fromCharCode(
      bytes[off + 4]!,
      bytes[off + 5]!,
      bytes[off + 6]!,
      bytes[off + 7]!,
    );
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = Buffer.from(bytes.buffer, bytes.byteOffset + off + 8, 4).readUInt32BE(0);
      h = Buffer.from(bytes.buffer, bytes.byteOffset + off + 12, 4).readUInt32BE(0);
    } else if (type === "IDAT") idat.push(data.slice());
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const raw = inflateSync(
    idat.reduce((acc, p) => {
      const next = new Uint8Array(acc.length + p.length);
      next.set(acc);
      next.set(p, acc.length);
      return next;
    }, new Uint8Array(0)),
  );
  const stride = w * 4;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const rs = y * (stride + 1) + 1;
    data.set(raw.subarray(rs, rs + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

function makeRgba(w: number, h: number): RgbaImage {
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
  test("shrinkPng decodes, box-resizes and re-encodes to a valid PNG", async () => {
    const src = makeRgba(64, 64);
    const out = await shrinkPng(encodePng(src), 8, 8);
    expect(out[0]).toBe(0x89);
    const decoded = decodeRgba(out);
    expect(decoded.width).toBe(8);
    expect(decoded.height).toBe(8);
    // Opaque half survives; transparent half stays transparent (box filter).
    expect(decoded.data[0 * 4 + 3]).toBe(255);
    expect(decoded.data[7 * 4 + 3]).toBe(0);
  });

  test("boxResize downscales with alpha weighting", () => {
    const src = makeRgba(64, 64);
    const out = boxResize(src, 8, 8);
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
    expect(out.data[3 * 4 + 3]).toBe(255);
    expect(out.data[4 * 4 + 3]).toBe(0);
    const mid = makeRgba(64, 64);
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
