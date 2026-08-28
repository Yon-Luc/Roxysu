import { readFileSync } from "node:fs";
import jpeg from "jpeg-js";
import { decodePngRgbaBytes, type RgbaImage } from "./pngRgba";

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isGif(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  );
}

function decodeJpegRgba(bytes: Uint8Array): RgbaImage | null {
  try {
    const decoded = jpeg.decode(bytes, { useTArray: true });
    if (decoded.width <= 0 || decoded.height <= 0) return null;
    return {
      width: decoded.width,
      height: decoded.height,
      data: new Uint8ClampedArray(decoded.data),
    };
  } catch {
    return null;
  }
}

/** Synchronous decode for PNG/JPEG (used during notes-layer compositing). */
export function decodeImageRgbaSync(filePath: string): RgbaImage | null {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(filePath);
  } catch {
    return null;
  }

  if (isPng(bytes)) {
    return decodePngRgbaBytes(bytes);
  }

  if (isJpeg(bytes)) {
    return decodeJpegRgba(bytes);
  }

  return null;
}

async function decodeViaBunImage(filePath: string): Promise<RgbaImage | null> {
  try {
    const pngBytes = await new Bun.Image(filePath).png().bytes();
    return decodePngRgbaBytes(pngBytes);
  } catch {
    return null;
  }
}

/** Decode PNG/JPEG/GIF skin sprites to RGBA. */
export async function decodeImageRgba(filePath: string): Promise<RgbaImage | null> {
  const sync = decodeImageRgbaSync(filePath);
  if (sync) return sync;

  let bytes: Uint8Array;
  try {
    bytes = readFileSync(filePath);
  } catch {
    return null;
  }

  if (isGif(bytes)) {
    return decodeViaBunImage(filePath);
  }

  return decodeViaBunImage(filePath);
}
