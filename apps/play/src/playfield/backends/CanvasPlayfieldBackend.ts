import os from "node:os";
import path from "node:path";
import type { PlayfieldSkin } from "../../skin/PlayfieldSkin";
import type { PlayfieldSkinLayout } from "../../skin/skinLayout";
import { spriteDestHeight } from "../../skin/skinLayout";
import { drawHoldBodyTiledRgba } from "../holdBodyTiled";
import { writePngRgbaFile } from "../pngRgba";
import {
  drawSpriteRgba,
  fillRectRgba,
  parseCssColor,
  type RgbaColor,
} from "../playfieldRaster";
import type {
  PlayfieldColumnSnapshot,
  PlayfieldRenderSnapshot,
} from "../PlayfieldTypes";
import { loadSpriteRgbaSync } from "../spriteRgbaCache";

const FRAME_PATHS = [
  path.join(os.tmpdir(), "roxysu-playfield-a.png"),
  path.join(os.tmpdir(), "roxysu-playfield-b.png"),
] as const;

export type CanvasPlayfieldRenderArgs = {
  snapshot: PlayfieldRenderSnapshot;
  skin: PlayfieldSkin;
  layout: PlayfieldSkinLayout;
  columns: readonly PlayfieldColumnSnapshot[];
  receptorY: number;
  separatorColor: string;
  staticKey: string;
  frameVersion: number;
  /** `notes` draws only scrolling notes on transparency over div underlay. */
  mode?: "full" | "notes";
};

function columnForLane(
  columns: readonly PlayfieldColumnSnapshot[],
  lane: number,
): PlayfieldColumnSnapshot {
  return (
    columns[lane] ?? {
      x: 0,
      w: 0,
      tapHeight: 18,
    }
  );
}

function holdNoteLayout(args: {
  startCenterY: number;
  endCenterY: number;
  column: PlayfieldColumnSnapshot;
  tailPath: string | null | undefined;
  spriteSizes: Readonly<Record<string, { w: number; h: number }>>;
}) {
  const { startCenterY, endCenterY, column, tailPath, spriteSizes } = args;
  const tapH = column.tapHeight;
  const noteW = column.w;
  const topCenter = Math.min(startCenterY, endCenterY);
  const bottomCenter = Math.max(startCenterY, endCenterY);
  const tailSize = tailPath ? spriteSizes[tailPath] : null;
  const tailH = tailPath
    ? Math.max(
        6,
        Math.min(spriteDestHeight(tailSize, noteW), tapH * 1.2),
      )
    : 0;
  const bodyTop = topCenter + tailH * 0.45;
  const bodyHeight = Math.max(0, bottomCenter - bodyTop);

  return {
    topCenter,
    bottomCenter,
    bodyTop,
    bodyHeight,
    headTop: startCenterY - tapH / 2,
    tailTop: topCenter - tailH * 0.15,
    tailH,
    tapH,
    noteW,
  };
}

/**
 * CPU canvas compositor: rasterizes the full playfield into one RGBA buffer,
 * then writes a PNG for a single GPUI `<img>`.
 */
export class CanvasPlayfieldBackend {
  private staticBuffer: Uint8ClampedArray | null = null;
  private staticKey = "";
  private staticWidth = 0;
  private staticHeight = 0;
  private frameBuffer: Uint8ClampedArray | null = null;
  private frameWidth = 0;
  private frameHeight = 0;

  render(args: CanvasPlayfieldRenderArgs): string | null {
    const { snapshot, skin, layout, columns, receptorY, separatorColor } = args;
    const mode = args.mode ?? "full";
    const width = snapshot.width;
    const height = snapshot.playfieldHeight;
    if (width <= 0 || height <= 0) return null;

    this.ensureFrameBuffer(width, height);
    const buffer = this.frameBuffer!;

    if (mode === "notes") {
      buffer.fill(0);
      this.drawNotes(buffer, width, height, args);
    } else {
      if (args.staticKey !== this.staticKey || !this.staticBuffer) {
        this.staticBuffer = this.buildStaticLayer({
          width,
          height,
          skin,
          layout,
          columns,
          receptorY,
          separatorColor,
          playfieldHeight: snapshot.playfieldHeight,
        });
        this.staticKey = args.staticKey;
        this.staticWidth = width;
        this.staticHeight = height;
      }

      buffer.set(this.staticBuffer);
      this.drawNotes(buffer, width, height, args);
    }

    if (mode === "notes" && snapshot.visibleCount === 0) {
      return null;
    }

    const outPath = FRAME_PATHS[args.frameVersion % 2]!;
    writePngRgbaFile(outPath, width, height, buffer);
    return outPath;
  }

  private ensureFrameBuffer(width: number, height: number): void {
    const size = width * height * 4;
    if (
      this.frameBuffer &&
      this.frameWidth === width &&
      this.frameHeight === height &&
      this.frameBuffer.length === size
    ) {
      return;
    }
    this.frameBuffer = new Uint8ClampedArray(size);
    this.frameWidth = width;
    this.frameHeight = height;
    this.staticKey = "";
  }

  private buildStaticLayer(args: {
    width: number;
    height: number;
    skin: PlayfieldSkin;
    layout: PlayfieldSkinLayout;
    columns: readonly PlayfieldColumnSnapshot[];
    receptorY: number;
    separatorColor: string;
    playfieldHeight: number;
  }): Uint8ClampedArray {
    const {
      width,
      height,
      skin,
      layout,
      columns,
      receptorY,
      separatorColor,
      playfieldHeight,
    } = args;
    const buffer = new Uint8ClampedArray(width * height * 4);
    const sprites = skin.sprites;
    const bg = parseCssColor(skin.playfieldBackground);
    fillRectRgba(buffer, width, height, 0, 0, width, height, bg, 1);

    if (sprites?.stageLeft && layout.stageLeft) {
      const sprite = loadSpriteRgbaSync(sprites.stageLeft);
      if (sprite) {
        drawSpriteRgba(buffer, width, height, sprite, {
          spritePath: sprites.stageLeft,
          x: layout.stageLeft.x,
          y: layout.stageLeft.y,
          width: layout.stageLeft.w,
          height: layout.stageLeft.h,
          alpha: 1,
        });
      }
    }

    if (sprites?.stageRight && layout.stageRight) {
      const sprite = loadSpriteRgbaSync(sprites.stageRight);
      if (sprite) {
        drawSpriteRgba(buffer, width, height, sprite, {
          spritePath: sprites.stageRight,
          x: layout.stageRight.x,
          y: layout.stageRight.y,
          width: layout.stageRight.w,
          height: layout.stageRight.h,
          alpha: 1,
        });
      }
    }

    const laneEven = parseCssColor(skin.laneBackgroundEven);
    const laneOdd = parseCssColor(skin.laneBackgroundOdd);
    for (let lane = 0; lane < columns.length; lane += 1) {
      const column = columns[lane]!;
      fillRectRgba(
        buffer,
        width,
        height,
        column.x,
        0,
        column.w,
        receptorY,
        lane % 2 === 0 ? laneEven : laneOdd,
        1,
      );
    }

    const sep = parseCssColor(separatorColor);
    for (let i = 1; i < layout.lines.length - 1; i += 1) {
      const x = layout.lines[i]! - 1;
      fillRectRgba(buffer, width, height, x, 0, 2, receptorY, sep, 1);
    }

    const below = parseCssColor(skin.belowReceptorBackground);
    fillRectRgba(
      buffer,
      width,
      height,
      0,
      receptorY,
      width,
      playfieldHeight - receptorY,
      below,
      1,
    );

    const line = parseCssColor(skin.judgmentLineColor);
    fillRectRgba(buffer, width, height, 0, receptorY, width, 3, line, 1);

    for (let lane = 0; lane < columns.length; lane += 1) {
      const column = columns[lane]!;
      const keySprite = sprites?.keysUp[lane];
      const noteW = column.w;
      const tapH = column.tapHeight;
      const keyH = Math.max(
        tapH,
        Math.min(
          spriteDestHeight(
            keySprite ? skin.spriteSizes[keySprite] : null,
            noteW,
          ),
          playfieldHeight - receptorY,
        ),
      );

      if (keySprite) {
        const sprite = loadSpriteRgbaSync(keySprite);
        if (sprite) {
          drawSpriteRgba(buffer, width, height, sprite, {
            spritePath: keySprite,
            x: column.x,
            y: receptorY,
            width: noteW,
            height: keyH,
            alpha: 1,
          });
          continue;
        }
      }

      const receptor = parseCssColor(skin.receptorFill);
      fillRectRgba(
        buffer,
        width,
        height,
        column.x + 7,
        receptorY - tapH * 0.5,
        Math.max(8, column.w - 14),
        skin.receptorHeight,
        receptor,
        1,
      );
    }

    return buffer;
  }

  private drawNotes(
    buffer: Uint8ClampedArray,
    width: number,
    height: number,
    args: CanvasPlayfieldRenderArgs,
  ): void {
    const { snapshot, skin, columns } = args;
    const sprites = skin.sprites;

    for (let i = 0; i < snapshot.visibleCount; i += 1) {
      const lane = snapshot.lane[i]!;
      const alpha = snapshot.alpha[i]!;
      const centerY = snapshot.y[i]!;
      const isHold = snapshot.isHold[i] === 1;
      const column = columnForLane(columns, lane);
      const headTop = centerY - column.tapHeight / 2;
      const headSprite = sprites?.notes[lane];
      const bodyPath = sprites?.bodies[lane];
      const useBodySprite =
        isHold && bodyPath != null && bodyPath !== headSprite;

      if (isHold) {
        const layoutHold = holdNoteLayout({
          startCenterY: centerY,
          endCenterY: snapshot.holdEndCenterY[i]!,
          column,
          tailPath: sprites?.tails[lane],
          spriteSizes: skin.spriteSizes,
        });

        if (
          useBodySprite &&
          bodyPath &&
          layoutHold.bodyHeight > 0 &&
          loadSpriteRgbaSync(bodyPath)
        ) {
          const sprite = loadSpriteRgbaSync(bodyPath)!;
          drawHoldBodyTiledRgba(
            buffer,
            width,
            height,
            sprite,
            column.x + column.w * 0.08,
            layoutHold.bottomCenter,
            column.w * 0.84,
            layoutHold.bodyHeight,
            alpha * 0.95,
          );
        } else if (layoutHold.bodyHeight > 0) {
          const color = laneColor(skin, lane);
          fillRectRgba(
            buffer,
            width,
            height,
            column.x + skin.notePadding,
            layoutHold.bodyTop,
            Math.max(4, column.w - skin.notePadding * 2),
            layoutHold.bodyHeight,
            color,
            alpha * 0.85,
          );
        }

        const tailSprite = sprites?.tails[lane];
        if (tailSprite && layoutHold.tailH > 0) {
          const sprite = loadSpriteRgbaSync(tailSprite);
          if (sprite) {
            drawSpriteRgba(buffer, width, height, sprite, {
              spritePath: tailSprite,
              x: column.x,
              y: layoutHold.tailTop,
              width: column.w,
              height: layoutHold.tailH,
              alpha,
            });
          }
        }
      }

      if (headSprite) {
        const sprite = loadSpriteRgbaSync(headSprite);
        if (sprite) {
          drawSpriteRgba(buffer, width, height, sprite, {
            spritePath: headSprite,
            x: column.x,
            y: headTop,
            width: column.w,
            height: column.tapHeight,
            alpha,
          });
          continue;
        }
      }

      const color = laneColor(skin, lane);
      fillRectRgba(
        buffer,
        width,
        height,
        column.x + skin.notePadding,
        headTop,
        Math.max(4, column.w - skin.notePadding * 2),
        column.tapHeight,
        color,
        alpha,
      );
    }
  }
}

function laneColor(skin: PlayfieldSkin, lane: number): RgbaColor {
  return parseCssColor(skin.laneColors[lane % skin.laneColors.length]!);
}

let sharedBackend: CanvasPlayfieldBackend | null = null;

export function renderPlayfieldCanvas(
  args: CanvasPlayfieldRenderArgs,
): string | null {
  if (!sharedBackend) {
    sharedBackend = new CanvasPlayfieldBackend();
  }
  return sharedBackend.render(args);
}
