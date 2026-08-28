import type { JudgmentResult } from "../integrations/mania-judge";

export type GameEvent =
  | { type: "NoteHit"; noteIndex: number; lane: number; result: JudgmentResult; timeMs: number }
  | { type: "NoteMiss"; noteIndex: number; lane: number; timeMs: number }
  | { type: "HoldCompleted"; noteIndex: number; lane: number; result: JudgmentResult; timeMs: number }
  | { type: "ComboChanged"; combo: number }
  | { type: "SongFinished"; timeMs: number };

export type GameEventListener = (event: GameEvent) => void;

export class GameEventBus {
  private readonly listeners = new Set<GameEventListener>();

  subscribe(listener: GameEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: GameEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
