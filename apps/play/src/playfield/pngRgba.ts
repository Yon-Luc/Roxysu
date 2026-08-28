import { readFileSync, writeFileSync } from "node:fs";
import { decode as decodePng, encode as encodePng } from "fast-png";

export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

function toRgba(
  width: number,
  height: number,
  data: Uint8Array | Uint8ClampedArray,
  channels: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (channels === 4) {
    rgba.set(data);
    return rgba;
  }

  for (let i = 0; i < width * height; i += 1) {
    const src = i * channels;
    const dst = i * 4;
    if (channels >= 3) {
      rgba[dst] = data[src]!;
      rgba[dst + 1] = data[src + 1]!;
      rgba[dst + 2] = data[src + 2]!;
      rgba[dst + 3] = channels === 4 ? data[src + 3]! : 255;
    } else {
      const gray = data[src]!;
      rgba[dst] = gray;
      rgba[dst + 1] = gray;
      rgba[dst + 2] = gray;
      rgba[dst + 3] = 255;
    }
  }
  return rgba;
}

/** Decode PNG bytes to RGBA (skin sprites and composited layers). */
export function decodePngRgbaBytes(bytes: Uint8Array): RgbaImage | null {
  try {
    const decoded = decodePng(bytes);
    if (decoded.width <= 0 || decoded.height <= 0) return null;
    return {
      width: decoded.width,
      height: decoded.height,
      data: toRgba(
        decoded.width,
        decoded.height,
        new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
        decoded.channels,
      ),
    };
  } catch {
    return null;
  }
}

/** Decode a PNG file to RGBA. */
export function decodePngRgba(filePath: string): RgbaImage | null {
  try {
    return decodePngRgbaBytes(readFileSync(filePath));
  } catch {
    return null;
  }
}

/** Encode RGBA pixels to an 8-bit RGBA PNG. */
export function encodePngRgba(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): Uint8Array {
  return encodePng({
    width,
    height,
    data: rgba,
    channels: 4,
    depth: 8,
  });
}

export function writePngRgbaFile(
  filePath: string,
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): void {
  writeFileSync(filePath, encodePngRgba(width, height, rgba));
}
