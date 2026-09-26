import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePngRgbaFile } from "./pngRgba";
import { fillRectRgba, parseCssColor, type RgbaColor } from "./playfieldRaster";

/** Ring size verified in texture Test C — one GPUI atlas slot per path, reused after wrap. */
export const PLAYFIELD_RING_SIZE = 64;

const SURFACE_DIR = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
  "var",
  "playfield-surface",
);

mkdirSync(SURFACE_DIR, { recursive: true });

/** Ring slot path. `generation` must increment each time a slot is reused — GPUI caches by path forever. */
export function playfieldSurfacePath(slot: number, generation: number): string {
  const index =
    ((slot % PLAYFIELD_RING_SIZE) + PLAYFIELD_RING_SIZE) %
    PLAYFIELD_RING_SIZE;
  return path.join(
    SURFACE_DIR,
    `frame-${String(index).padStart(2, "0")}-g${generation}.png`,
  );
}

/** @deprecated Use playfieldSurfacePath(slot, generation) */
export function playfieldSurfaceRingPath(slot: number): string {
  return playfieldSurfacePath(slot, 0);
}

export function playfieldSurfaceDir(): string {
  return SURFACE_DIR;
}

/** Ensure every ring slot exists before GPUI first reads any path. */
export function primePlayfieldSurfaceRing(
  width: number,
  height: number,
  background: string,
): void {
  if (width <= 0 || height <= 0) return;

  const rgba = new Uint8ClampedArray(width * height * 4);
  const bg: RgbaColor = parseCssColor(background);
  fillRectRgba(rgba, width, height, 0, 0, width, height, bg, 1);

  for (let slot = 0; slot < PLAYFIELD_RING_SIZE; slot += 1) {
    writePngRgbaFile(playfieldSurfacePath(slot, 0), width, height, rgba);
  }
}
