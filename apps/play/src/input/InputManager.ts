import type { EventPayload } from "@gpuix/react";
import { InputState } from "./InputState";
import { DEFAULT_7K_BINDINGS, laneForKey, type KeyBindings } from "./KeyBindings";

export type InputEvent =
  | { type: "press"; lane: number; timeMs: number }
  | { type: "release"; lane: number; timeMs: number };

export class InputManager {
  readonly state = new InputState();
  private readonly bindings: KeyBindings;
  private readonly queue: InputEvent[] = [];

  constructor(bindings: KeyBindings = DEFAULT_7K_BINDINGS) {
    this.bindings = bindings;
  }

  handleKeyDown(event: EventPayload, timeMs: number): void {
    const key = event.key;
    if (!key) return;
    const lane = laneForKey(key, this.bindings);
    if (lane == null || this.state.isHeld(lane)) return;
    this.state.press(lane);
    this.queue.push({ type: "press", lane, timeMs });
  }

  handleKeyUp(event: EventPayload, timeMs: number): void {
    const key = event.key;
    if (!key) return;
    const lane = laneForKey(key, this.bindings);
    if (lane == null || !this.state.isHeld(lane)) return;
    this.state.release(lane);
    this.queue.push({ type: "release", lane, timeMs });
  }

  drain(): InputEvent[] {
    if (this.queue.length === 0) return [];
    const events = this.queue.slice();
    this.queue.length = 0;
    return events;
  }

  reset(): void {
    this.state.clear();
    this.queue.length = 0;
  }
}
