import type { RgbaColor } from "./playfieldRaster";

export type NoteStyle = {
  color: RgbaColor;
  alpha: number;
};

/** Abstraction between playfield logic and the rendering backend. */
export interface PlayfieldDrawContext {
  beginFrame(width: number, height: number): void;
  endFrame(): void;

  fillRect(
    x: number,
    y: number,
    width: number,
    height: number,
    color: RgbaColor,
    alpha?: number,
  ): void;

  drawSprite(
    spritePath: string,
    x: number,
    y: number,
    width: number,
    height: number,
    alpha: number,
  ): void;

  drawHoldBody(
    spritePath: string,
    x: number,
    yBottom: number,
    width: number,
    height: number,
    alpha: number,
  ): void;
}
