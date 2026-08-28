export function noteHeadY(
  noteStartMs: number,
  songTimeMs: number,
  receptorY: number,
  pixelsPerMs: number,
): number {
  return receptorY - (noteStartMs - songTimeMs) * pixelsPerMs;
}

export function receptorHitTop(receptorY: number, tapHeight: number): number {
  return receptorY - tapHeight;
}

/** Once a note reaches its hit time, pin it on the receptor instead of scrolling past. */
export function clampNoteTopAtReceptor(
  rawTop: number,
  hitTimeMs: number,
  songTimeMs: number,
  receptorY: number,
  tapHeight: number,
): number {
  if (songTimeMs < hitTimeMs) {
    return rawTop;
  }
  return Math.min(rawTop, receptorHitTop(receptorY, tapHeight));
}

export function tapBounds(
  noteStartMs: number,
  songTimeMs: number,
  receptorY: number,
  pixelsPerMs: number,
  tapHeight: number,
): { top: number; height: number } {
  const rawTop = noteHeadY(noteStartMs, songTimeMs, receptorY, pixelsPerMs);
  const top = clampNoteTopAtReceptor(
    rawTop,
    noteStartMs,
    songTimeMs,
    receptorY,
    tapHeight,
  );
  return { top, height: tapHeight };
}

export function holdBodyBounds(
  noteStartMs: number,
  noteEndMs: number,
  songTimeMs: number,
  receptorY: number,
  pixelsPerMs: number,
  tapHeight: number,
): { top: number; height: number } {
  const headTop = noteHeadY(noteStartMs, songTimeMs, receptorY, pixelsPerMs);
  const tailTop = noteHeadY(noteEndMs, songTimeMs, receptorY, pixelsPerMs);
  const top = Math.min(headTop, tailTop);
  const bottom = Math.max(headTop, tailTop) + tapHeight;
  return { top, height: Math.max(tapHeight, bottom - top) };
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
    return noteHeadY(noteStartMs, songTimeMs, this.receptorY, pixelsPerMs);
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
