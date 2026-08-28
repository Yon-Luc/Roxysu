export class InputState {
  private readonly held = new Uint8Array(16);

  press(lane: number): void {
    if (lane < 0 || lane >= this.held.length) return;
    this.held[lane] = 1;
  }

  release(lane: number): void {
    if (lane < 0 || lane >= this.held.length) return;
    this.held[lane] = 0;
  }

  isHeld(lane: number): boolean {
    return lane >= 0 && lane < this.held.length && this.held[lane] === 1;
  }

  clear(): void {
    this.held.fill(0);
  }
}
