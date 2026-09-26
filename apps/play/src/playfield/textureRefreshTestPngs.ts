import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writePngRgbaFile } from "./pngRgba";
import { fillRectRgba, type RgbaColor } from "./playfieldRaster";

export type TextureTestMode = "A" | "B" | "C";

export const TEXTURE_TEST_RING_SIZE = 64;

const TEST_DIR = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
  "var",
  "texture-test",
);

mkdirSync(TEST_DIR, { recursive: true });

export const TEXTURE_TEST_SIZE = { width: 480, height: 320 };

/** Mode A — single file, overwritten each frame. */
export const TEXTURE_TEST_PATH_SAME = path.join(TEST_DIR, "frame.png");

/** Mode B — ping-pong; never overwrite the path currently on screen. */
export const TEXTURE_TEST_PATH_A = path.join(TEST_DIR, "frame-a.png");
export const TEXTURE_TEST_PATH_B = path.join(TEST_DIR, "frame-b.png");

/** Mode C — ring buffer `frame-00.png` … `frame-63.png`. */
export function textureTestRingPath(slot: number): string {
  const index = ((slot % TEXTURE_TEST_RING_SIZE) + TEXTURE_TEST_RING_SIZE) % TEXTURE_TEST_RING_SIZE;
  return path.join(TEST_DIR, `frame-${String(index).padStart(2, "0")}.png`);
}

const BG_A: RgbaColor = [127, 29, 29, 255];
const BG_B: RgbaColor = [30, 58, 138, 255];
const BG_NEUTRAL: RgbaColor = [24, 24, 27, 255];
const LETTER: RgbaColor = [255, 255, 255, 255];
const BAR: RgbaColor = [250, 204, 21, 255];
const ACCENT: RgbaColor = [34, 211, 238, 255];

/** Full bar cycle — same visual speed at any refresh rate (was 18 steps @ 60 Hz). */
export const TEXTURE_TEST_BAR_CYCLE_MS = 300;
const BAR_STEP_PX = 12;
const BAR_STEP_COUNT = 18;
const BAR_BASE_Y = 48;

const TICK_CYCLE_MS = 800;
const TICK_STEP_COUNT = 8;

export function textureTestBarY(timeMs: number): number {
  const step = Math.floor(
    (timeMs % TEXTURE_TEST_BAR_CYCLE_MS) /
      (TEXTURE_TEST_BAR_CYCLE_MS / BAR_STEP_COUNT),
  );
  return BAR_BASE_Y + step * BAR_STEP_PX;
}

function textureTestTickWidth(timeMs: number): number {
  const step = Math.floor(
    (timeMs % TICK_CYCLE_MS) / (TICK_CYCLE_MS / TICK_STEP_COUNT),
  );
  return 12 + step * 10;
}

function drawMotionMarkers(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  timeMs: number,
): void {
  const barY = textureTestBarY(timeMs);
  fillRectRgba(rgba, width, height, 32, barY, width - 64, 18, BAR, 1);
  const tickW = textureTestTickWidth(timeMs);
  fillRectRgba(rgba, width, height, width - tickW - 16, 16, tickW, 12, ACCENT, 1);
}

/** 9×11 bitmap glyphs (# = ink). */
const GLYPH_A = [
  "    ###    ",
  "   #   #   ",
  "  #     #  ",
  "  #     #  ",
  "  #######  ",
  "  #     #  ",
  "  #     #  ",
  "  #     #  ",
  "  #     #  ",
  "  #     #  ",
  "           ",
] as const;

const GLYPH_B = [
  "  ######   ",
  "  #     #  ",
  "  #     #  ",
  "  ######   ",
  "  #     #  ",
  "  #     #  ",
  "  #     #  ",
  "  ######   ",
  "           ",
  "           ",
  "           ",
] as const;

function drawGlyph(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  glyph: readonly string[],
  originX: number,
  originY: number,
  scale: number,
  color: RgbaColor,
): void {
  for (let row = 0; row < glyph.length; row += 1) {
    const line = glyph[row]!;
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] !== "#") continue;
      fillRectRgba(
        rgba,
        width,
        height,
        originX + col * scale,
        originY + row * scale,
        scale,
        scale,
        color,
        1,
      );
    }
  }
}

/**
 * Write a unmistakable test frame: huge letter + moving bar.
 * `timeMs` drives motion (wall clock) — not frame count.
 */
export function writeTextureRefreshFrame(
  targetPath: string,
  letter: "A" | "B",
  timeMs: number,
): void {
  const { width, height } = TEXTURE_TEST_SIZE;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const bg = letter === "A" ? BG_A : BG_B;
  fillRectRgba(rgba, width, height, 0, 0, width, height, bg, 1);

  const glyph = letter === "A" ? GLYPH_A : GLYPH_B;
  const scale = 14;
  const glyphW = 11 * scale;
  const glyphH = glyph.length * scale;
  drawGlyph(
    rgba,
    width,
    height,
    glyph,
    Math.floor((width - glyphW) / 2),
    Math.floor((height - glyphH) / 2) - 24,
    scale,
    LETTER,
  );

  drawMotionMarkers(rgba, width, height, timeMs);

  writePngRgbaFile(targetPath, width, height, rgba);
}

/** Mode A — neutral bg, letter A, moving bar (overwrite same path). */
export function writeTextureRefreshFrameSamePath(
  targetPath: string,
  timeMs: number,
): void {
  const { width, height } = TEXTURE_TEST_SIZE;
  const rgba = new Uint8ClampedArray(width * height * 4);
  fillRectRgba(rgba, width, height, 0, 0, width, height, BG_NEUTRAL, 1);

  const scale = 14;
  const glyphW = 11 * scale;
  const glyphH = GLYPH_A.length * scale;
  drawGlyph(
    rgba,
    width,
    height,
    GLYPH_A,
    Math.floor((width - glyphW) / 2),
    Math.floor((height - glyphH) / 2) - 24,
    scale,
    LETTER,
  );

  drawMotionMarkers(rgba, width, height, timeMs);

  writePngRgbaFile(targetPath, width, height, rgba);
}

export function primeTextureTestForMode(mode: TextureTestMode): void {
  if (mode === "A") {
    writeTextureRefreshFrameSamePath(TEXTURE_TEST_PATH_SAME, 0);
    return;
  }
  if (mode === "B") {
    writeTextureRefreshFrame(TEXTURE_TEST_PATH_A, "A", 0);
    writeTextureRefreshFrame(TEXTURE_TEST_PATH_B, "B", 0);
    return;
  }
  for (let slot = 0; slot < TEXTURE_TEST_RING_SIZE; slot += 1) {
    writeTextureRefreshFrame(
      textureTestRingPath(slot),
      slot % 2 === 0 ? "A" : "B",
      0,
    );
  }
}

export function textureTestDir(): string {
  return TEST_DIR;
}

export function textureTestFileExists(filePath: string): boolean {
  return existsSync(filePath);
}
