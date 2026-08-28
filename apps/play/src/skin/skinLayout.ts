import {
  DEFAULT_COLUMN_START,
  DEFAULT_HIT_POSITION_PX,
  layoutManiaPlayfield,
  OSU_MANIA_HEIGHT,
  type ManiaPlayfieldLayout,
  type SkinIniManiaSection,
} from "../integrations/osu-skin-ini";
import type { ImageDimensions } from "./readImageDimensions";
import type { PlayfieldSkinSprites } from "./PlayfieldSkin";

/** osu!stable mania coordinate width used by skin.ini ColumnStart. */
export const OSU_MANIA_WIDTH = 640;

export type PlayfieldAlign = "center" | "left";

export type PlayfieldColumnLayout = {
  x: number;
  w: number;
  tapHeight: number;
};

export type PlayfieldSkinLayout = {
  columns: PlayfieldColumnLayout[];
  lines: number[];
  receptorY: number;
  stageLeft: ManiaPlayfieldLayout["stageLeft"];
  stageRight: ManiaPlayfieldLayout["stageRight"];
};

export type ImportedManiaLayout = {
  hitPositionPx: number;
  columnWidth: number[];
  columnSpacing: number[];
  columnLineWidth: number[];
  columnStart: number;
};

export function maniaSectionToLayout(section: SkinIniManiaSection): ImportedManiaLayout {
  return {
    hitPositionPx: section.hitPosition,
    columnWidth: [...section.columnWidth],
    columnSpacing: [...section.columnSpacing],
    columnLineWidth: [...section.columnLineWidth],
    columnStart: section.columnStart,
  };
}

export function spriteDestHeight(
  size: ImageDimensions | null | undefined,
  destW: number,
): number {
  if (!size || size.w <= 0) return destW;
  return destW * (size.h / size.w);
}

export function columnTapHeight(
  colW: number,
  notePath: string | null | undefined,
  sizes: Readonly<Record<string, ImageDimensions>>,
): number {
  if (colW <= 0) return 18;
  const size = notePath ? sizes[notePath] : null;
  if (!size) return Math.max(18, Math.min(colW, colW * 0.55));
  return Math.max(8, Math.min(spriteDestHeight(size, colW), colW * 1.4));
}

function stageSize(
  path: string | null | undefined,
  sizes: Readonly<Record<string, ImageDimensions>>,
): { w: number; h: number } | null {
  if (!path) return null;
  const size = sizes[path];
  if (!size || size.w <= 0 || size.h <= 0) return null;
  return size;
}

function shiftLayout(
  layout: ManiaPlayfieldLayout,
  offsetX: number,
  columns: PlayfieldColumnLayout[],
): PlayfieldSkinLayout {
  return {
    columns: columns.map((col, index) => ({
      ...col,
      x: (layout.columns[index]?.x ?? col.x) + offsetX,
    })),
    lines: layout.lines.map((x) => x + offsetX),
    receptorY: layout.receptorY,
    stageLeft: layout.stageLeft
      ? { ...layout.stageLeft, x: layout.stageLeft.x + offsetX }
      : null,
    stageRight: layout.stageRight
      ? { ...layout.stageRight, x: layout.stageRight.x + offsetX }
      : null,
  };
}

export function buildPlayfieldSkinLayout(args: {
  width: number;
  height: number;
  keys: number;
  maniaLayout: ImportedManiaLayout | null;
  sprites: PlayfieldSkinSprites | null;
  spriteSizes: Readonly<Record<string, ImageDimensions>>;
  align: PlayfieldAlign;
  /** Fraction of playfield height (0–1). Used when no skin.ini layout is loaded. */
  hitPosition?: number;
}): PlayfieldSkinLayout {
  const keys = Math.max(1, args.keys);

  if (args.maniaLayout && args.sprites) {
    const base = layoutManiaPlayfield({
      canvasW: args.width,
      canvasH: args.height,
      keys,
      columnWidth: args.maniaLayout.columnWidth,
      columnSpacing: args.maniaLayout.columnSpacing,
      hitPositionPx: args.maniaLayout.hitPositionPx,
      stageLeft: stageSize(args.sprites.stageLeft, args.spriteSizes),
      stageRight: stageSize(args.sprites.stageRight, args.spriteSizes),
    });

    const columns: PlayfieldColumnLayout[] = base.columns.map((col, lane) => ({
      x: col.x,
      w: col.w,
      tapHeight: columnTapHeight(
        col.w,
        args.sprites!.notes[lane],
        args.spriteSizes,
      ),
    }));

    const blockLeft = base.lines[0] ?? 0;
    const blockRight = base.lines[base.lines.length - 1] ?? args.width;
    const blockWidth = Math.max(0, blockRight - blockLeft);

    let offsetX = 0;
    if (args.align === "center") {
      offsetX = (args.width - blockWidth) / 2 - blockLeft;
    } else {
      const scaledStart =
        args.maniaLayout.columnStart * (args.width / OSU_MANIA_WIDTH);
      offsetX = scaledStart - blockLeft;
    }

    return shiftLayout(base, offsetX, columns);
  }

  const hitPositionPx =
    args.hitPosition != null
      ? args.hitPosition * OSU_MANIA_HEIGHT
      : DEFAULT_HIT_POSITION_PX;

  const base = layoutManiaPlayfield({
    canvasW: args.width,
    canvasH: args.height,
    keys,
    columnWidth: Array.from({ length: keys }, () => 1),
    columnSpacing: Array.from({ length: Math.max(0, keys - 1) }, () => 0),
    hitPositionPx,
  });

  const columns: PlayfieldColumnLayout[] = base.columns.map((col) => ({
    x: col.x,
    w: col.w,
    tapHeight: 18,
  }));

  if (args.align === "left") {
    const scaledStart = DEFAULT_COLUMN_START * (args.width / OSU_MANIA_WIDTH);
    const blockLeft = base.lines[0] ?? 0;
    return shiftLayout(base, scaledStart - blockLeft, columns);
  }

  const blockLeft = base.lines[0] ?? 0;
  const blockRight = base.lines[base.lines.length - 1] ?? args.width;
  const offsetX = (args.width - (blockRight - blockLeft)) / 2 - blockLeft;
  return shiftLayout(base, offsetX, columns);
}
