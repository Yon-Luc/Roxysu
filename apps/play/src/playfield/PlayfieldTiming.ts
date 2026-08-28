export class PlayfieldTiming {
  private songTimeMs = 0;
  private scrollSpeed = 24;
  private playing = false;

  setSongTime(timeMs: number): void {
    this.songTimeMs = Math.max(0, timeMs);
  }

  getSongTime(): number {
    return this.songTimeMs;
  }

  setScrollSpeed(speed: number): void {
    this.scrollSpeed = Math.max(1, speed);
  }

  getScrollSpeed(): number {
    return this.scrollSpeed;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  pixelsPerMs(): number {
    return this.scrollSpeed / 1000;
  }
}
