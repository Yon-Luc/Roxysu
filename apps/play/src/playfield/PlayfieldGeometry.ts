export function noteHeadY(
  noteStartMs: number,
  songTimeMs: number,
  receptorY: number,
  pixelsPerMs: number,
): number {
  return receptorY - (noteStartMs - songTimeMs) * pixelsPerMs;
}

export function noteHeight(
  noteStartMs: number,
  noteEndMs: number,
  pixelsPerMs: number,
  tapHeight: number,
): number {
  if (noteEndMs <= noteStartMs + 20) {
    return tapHeight;
  }
  return Math.max(tapHeight, (noteEndMs - noteStartMs) * pixelsPerMs);
}

export class PlayfieldGeometry {
  constructor(
    private receptorY: number,
    private tapHeight = 18,
  ) {}

  setReceptorY(value: number): void {
    this.receptorY = value;
  }

  getReceptorY(): number {
    return this.receptorY;
  }

  headY(noteStartMs: number, songTimeMs: number, pixelsPerMs: number): number {
    return noteHeadY(noteStartMs, songTimeMs, this.receptorY, pixelsPerMs);
  }

  height(
    noteStartMs: number,
    noteEndMs: number,
    pixelsPerMs: number,
  ): number {
    return noteHeight(noteStartMs, noteEndMs, pixelsPerMs, this.tapHeight);
  }
}
