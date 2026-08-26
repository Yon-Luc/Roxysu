/**
 * Minimal PNG decode → box-downscale → encode pipeline used by the build
 * script to shrink the watermark logo. Supports the common subset: bit depth
 * 8, no interlace, color types 0 (gray), 2 (rgb), 3 (palette), 4 (gray+a),
 * 6 (rgba). Output is always 8-bit RGBA.
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export type RgbaImage = { width: number; height: number; data: Uint8Array };

export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < 8; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error("not a png");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;

  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(
      bytes[off + 4]!,
      bytes[off + 5]!,
      bytes[off + 6]!,
      bytes[off + 7]!,
    );
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = dv.getUint32(off + 8);
      height = dv.getUint32(off + 12);
      bitDepth = bytes[off + 16]!;
      colorType = bytes[off + 17]!;
      interlace = bytes[off + 20]!;
    } else if (type === "PLTE") {
      palette = data.slice();
    } else if (type === "tRNS") {
      trns = data.slice();
    } else if (type === "IDAT") {
      idat.push(data.slice());
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }

  if (!width || !height) throw new Error("missing IHDR");
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("interlaced png unsupported");
  const channelsByType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);

  const raw = inflateSync(
    idat.reduce((acc, part) => {
      const next = new Uint8Array(acc.length + part.length);
      next.set(acc);
      next.set(part, acc.length);
      return next;
    }, new Uint8Array(0)),
  );

  const stride = width * channels;
  const expected = (stride + 1) * height;
  if (raw.length < expected) throw new Error("truncated pixel data");

  // Undo per-scanline filters in place.
  const bpp = channels;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart]!;
    const row = rowStart + 1;
    const prev = y > 0 ? row - (stride + 1) + 1 : -1;
    for (let x = 0; x < stride; x += 1) {
      const v = raw[row + x]!;
      const left = x >= bpp ? raw[row + x - bpp]! : 0;
      const up = y > 0 ? raw[prev + x]! : 0;
      const upLeft =
        y > 0 && x >= bpp ? raw[prev + x - bpp]! : 0;
      let out = v;
      if (filter === 1) out = v + left;
      else if (filter === 2) out = v + up;
      else if (filter === 3) out = v + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        out = v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      } else if (filter !== 0) {
        throw new Error(`unsupported filter ${filter}`);
      }
      raw[row + x] = out & 0xff;
    }
  }

  // Expand to RGBA.
  const rgba = new Uint8Array(width * height * 4);
  const at = (y: number, x: number, c: number): number =>
    raw[y * (stride + 1) + 1 + x * channels + c]!;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (colorType === 6) {
        rgba[o] = at(y, x, 0);
        rgba[o + 1] = at(y, x, 1);
        rgba[o + 2] = at(y, x, 2);
        rgba[o + 3] = at(y, x, 3);
      } else if (colorType === 2) {
        rgba[o] = at(y, x, 0);
        rgba[o + 1] = at(y, x, 1);
        rgba[o + 2] = at(y, x, 2);
        rgba[o + 3] = 255;
      } else if (colorType === 0) {
        const g = at(y, x, 0);
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      } else if (colorType === 4) {
        const g = at(y, x, 0);
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = at(y, x, 1);
      } else {
        const idx = at(y, x, 0);
        if (!palette) throw new Error("palette chunk missing");
        rgba[o] = palette[idx * 3]!;
        rgba[o + 1] = palette[idx * 3 + 1]!;
        rgba[o + 2] = palette[idx * 3 + 2]!;
        rgba[o + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      }
    }
  }

  return { width, height, data: rgba };
}

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

export function encodePng(img: RgbaImage): Uint8Array {
  const stride = img.width * 4;
  const raw = new Uint8Array((stride + 1) * img.height);
  for (let y = 0; y < img.height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter none
    raw.set(
      img.data.subarray(y * stride, (y + 1) * stride),
      y * (stride + 1) + 1,
    );
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, img.width);
  dv.setUint32(4, img.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // rgba
  return [
    Uint8Array.from(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ].reduce((acc, part) => {
    const next = new Uint8Array(acc.length + part.length);
    next.set(acc);
    next.set(part, acc.length);
    return next;
  }, new Uint8Array(0));
}
