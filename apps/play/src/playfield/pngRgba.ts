import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, inflateSync } from "fflate";

export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function writeU32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function readChunk(
  bytes: Uint8Array,
  offset: number,
): { type: string; data: Uint8Array; next: number } | null {
  if (offset + 8 > bytes.length) return null;
  const length = readU32BE(bytes, offset);
  const type = String.fromCharCode(
    bytes[offset + 4]!,
    bytes[offset + 5]!,
    bytes[offset + 6]!,
    bytes[offset + 7]!,
  );
  const start = offset + 8;
  const end = start + length;
  if (end + 4 > bytes.length) return null;
  return {
    type,
    data: bytes.subarray(start, end),
    next: end + 4,
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterScanline(
  filter: number,
  row: Uint8Array,
  previous: Uint8Array | null,
  bpp: number,
): void {
  if (filter === 0 || !previous) return;
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bpp ? row[i - bpp]! : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bpp ? previous[i - bpp]! : 0;
    switch (filter) {
      case 1:
        row[i] = (row[i]! + left) & 0xff;
        break;
      case 2:
        row[i] = (row[i]! + up) & 0xff;
        break;
      case 3:
        row[i] = (row[i]! + Math.floor((left + up) / 2)) & 0xff;
        break;
      case 4:
        row[i] = (row[i]! + paeth(left, up, upLeft)) & 0xff;
        break;
      default:
        break;
    }
  }
}

/** Decode 8-bit RGB/RGBA PNG files (skin sprites). */
export function decodePngRgba(filePath: string): RgbaImage | null {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(filePath);
  } catch {
    return null;
  }
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return null;
  }

  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatParts: Uint8Array[] = [];
  let offset = 8;

  while (offset < bytes.length) {
    const chunk = readChunk(bytes, offset);
    if (!chunk) break;
    offset = chunk.next;

    if (chunk.type === "IHDR" && chunk.data.length >= 13) {
      width = readU32BE(chunk.data, 0);
      height = readU32BE(chunk.data, 4);
      colorType = chunk.data[9]!;
    } else if (chunk.type === "IDAT") {
      idatParts.push(chunk.data);
    } else if (chunk.type === "IEND") {
      break;
    }
  }

  if (width <= 0 || height <= 0 || idatParts.length === 0) return null;

  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bpp === 0) return null;

  const total = idatParts.reduce((sum, part) => sum + part.length, 0);
  const compressed = new Uint8Array(total);
  let write = 0;
  for (const part of idatParts) {
    compressed.set(part, write);
    write += part.length;
  }

  const inflated = inflateSync(compressed);
  const stride = width * bpp;
  const rgba = new Uint8ClampedArray(width * height * 4);
  let sourceOffset = 0;
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset]!;
    sourceOffset += 1;
    const row = inflated.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    const copy = new Uint8Array(row);
    unfilterScanline(filter, copy, y === 0 ? null : previous, bpp);
    previous = copy;

    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 4;
      if (bpp === 4) {
        rgba[dst] = copy[x * 4]!;
        rgba[dst + 1] = copy[x * 4 + 1]!;
        rgba[dst + 2] = copy[x * 4 + 2]!;
        rgba[dst + 3] = copy[x * 4 + 3]!;
      } else {
        rgba[dst] = copy[x * 3]!;
        rgba[dst + 1] = copy[x * 3 + 1]!;
        rgba[dst + 2] = copy[x * 3 + 2]!;
        rgba[dst + 3] = 255;
      }
    }
  }

  return { width, height, data: rgba };
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i]!;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeChunk(parts: number[], type: string, data: Uint8Array): void {
  const typeBytes = new TextEncoder().encode(type);
  parts.push(
    (data.length >>> 24) & 0xff,
    (data.length >>> 16) & 0xff,
    (data.length >>> 8) & 0xff,
    data.length & 0xff,
  );
  for (const byte of typeBytes) parts.push(byte);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  for (const byte of data) parts.push(byte);
  const crc = crc32(crcInput);
  parts.push((crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff);
}

/** Encode RGBA pixels to an 8-bit RGBA PNG. */
export function encodePngRgba(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), rowStart + 1);
  }

  const idat = deflateSync(raw, { level: 1 });
  const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeChunk(parts, "IHDR", ihdr);
  writeChunk(parts, "IDAT", idat);
  writeChunk(parts, "IEND", new Uint8Array(0));

  return Uint8Array.from(parts);
}

export function writePngRgbaFile(
  filePath: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): void {
  writeFileSync(filePath, encodePngRgba(width, height, rgba));
}
