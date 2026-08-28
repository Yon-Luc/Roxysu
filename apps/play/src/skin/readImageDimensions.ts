import { readFileSync } from "node:fs";

export type ImageDimensions = { w: number; h: number };

/** Read raster dimensions from PNG, JPEG, or GIF headers (no decode). */
export function readImageDimensions(filePath: string): ImageDimensions | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(filePath);
  } catch {
    return null;
  }
  if (bytes.length < 24) return null;

  // PNG
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
  }

  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) };
  }

  // JPEG — scan for SOF0 / SOF2
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          h: bytes.readUInt16BE(offset + 5),
          w: bytes.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }

  return null;
}
