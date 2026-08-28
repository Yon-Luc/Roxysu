/** Y coordinate of a note at `noteTimeMs` — osu! mania uses the note center line. */
export function noteCenterY(
  noteTimeMs: number,
  songTimeMs: number,
  receptorY: number,
  pixelsPerMs: number,
): number {
  return receptorY - (noteTimeMs - songTimeMs) * pixelsPerMs;
}

/** Once a note reaches its hit time, pin its center on the receptor instead of scrolling past. */
export function clampNoteCenterAtReceptor(
  rawCenter: number,
  hitTimeMs: number,
  songTimeMs: number,
  receptorY: number,
  tapHeight: number,
): number {
  if (songTimeMs < hitTimeMs) {
    return rawCenter;
  }
  return Math.min(rawCenter, receptorY - tapHeight / 2);
}

export function receptorHitTop(receptorY: number, tapHeight: number): number {
  return receptorY - tapHeight;
}

export function tapBounds(
  noteStartMs: number,
  songTimeMs: number,
  receptorY: number,
  pixelsPerMs: number,
  tapHeight: number,
): { centerY: number; top: number; height: number } {
  const rawCenter = noteCenterY(
    noteStartMs,
    songTimeMs,
    receptorY,
    pixelsPerMs,
  );
  const centerY = clampNoteCenterAtReceptor(
    rawCenter,
    noteStartMs,
    songTimeMs,
    receptorY,
    tapHeight,
  );
  return { centerY, top: centerY - tapHeight / 2, height: tapHeight };
}

export function holdBodyBounds(
  noteStartMs: number,
  noteEndMs: number,
  songTimeMs: number,
  receptorY: number,
  pixelsPerMs: number,
  tapHeight: number,
): {
  startCenterY: number;
  endCenterY: number;
  topCenter: number;
  bottomCenter: number;
  top: number;
  height: number;
} {
  const rawStartCenter = noteCenterY(
    noteStartMs,
    songTimeMs,
    receptorY,
    pixelsPerMs,
  );
  const startCenterY = clampNoteCenterAtReceptor(
    rawStartCenter,
    noteStartMs,
    songTimeMs,
    receptorY,
    tapHeight,
  );
  const endCenterY = noteCenterY(
    noteEndMs,
    songTimeMs,
    receptorY,
    pixelsPerMs,
  );
  const topCenter = Math.min(startCenterY, endCenterY);
  const bottomCenter = Math.max(startCenterY, endCenterY);
  return {
    startCenterY,
    endCenterY,
    topCenter,
    bottomCenter,
    top: topCenter - tapHeight / 2,
    height: bottomCenter - topCenter + tapHeight,
  };
}

export function isNoteVisible(
  top: number,
  height: number,
  playfieldHeight: number,
): boolean {
  return top + height > 0 && top < playfieldHeight;
}

export function clipToPlayfield(
  top: number,
  height: number,
  playfieldHeight: number,
): { top: number; height: number } | null {
  const bottom = top + height;
  const clipTop = Math.max(0, top);
  const clipBottom = Math.min(playfieldHeight, bottom);
  const clipHeight = clipBottom - clipTop;
  if (clipHeight <= 0) {
    return null;
  }
  return { top: clipTop, height: clipHeight };
}

export class PlayfieldGeometry {
  constructor(
    private receptorY: number,
    private columnTapHeights: readonly number[] = [],
    private defaultTapHeight = 18,
  ) {}

  setReceptorY(value: number): void {
    this.receptorY = value;
  }

  setColumnTapHeights(heights: readonly number[]): void {
    this.columnTapHeights = heights;
  }

  getReceptorY(): number {
    return this.receptorY;
  }

  tapHeightFor(lane: number): number {
    return this.columnTapHeights[lane] ?? this.defaultTapHeight;
  }

  headY(noteStartMs: number, songTimeMs: number, pixelsPerMs: number): number {
    return noteCenterY(noteStartMs, songTimeMs, this.receptorY, pixelsPerMs);
  }

  tap(noteStartMs: number, songTimeMs: number, pixelsPerMs: number, lane = 0) {
    const tapHeight = this.tapHeightFor(lane);
    return tapBounds(
      noteStartMs,
      songTimeMs,
      this.receptorY,
      pixelsPerMs,
      tapHeight,
    );
  }

  hold(
    noteStartMs: number,
    noteEndMs: number,
    songTimeMs: number,
    pixelsPerMs: number,
    lane = 0,
  ) {
    const tapHeight = this.tapHeightFor(lane);
    return holdBodyBounds(
      noteStartMs,
      noteEndMs,
      songTimeMs,
      this.receptorY,
      pixelsPerMs,
      tapHeight,
    );
  }
}
