import type { GameEvent } from "../events/GameEventBus";
import type { JudgmentResult } from "../integrations/mania-judge";

export type JudgmentPopup = {
  id: number;
  lane: number;
  label: string;
  expiresAtMs: number;
};

const POPUP_DURATION_MS = 700;

const LABELS: Record<JudgmentResult, string> = {
  perfect: "Perfect",
  great: "Great",
  good: "Good",
  ok: "Ok",
  meh: "Meh",
  miss: "Miss",
};

export class JudgmentEffects {
  private popups: JudgmentPopup[] = [];
  private nextId = 0;

  handle(event: GameEvent, songTimeMs: number): void {
    if (event.type === "NoteHit") {
      this.push(event.lane, LABELS[event.result], songTimeMs);
      return;
    }
    if (event.type === "NoteMiss") {
      this.push(event.lane, "Miss", songTimeMs);
      return;
    }
    if (event.type === "HoldCompleted" && event.result !== "miss") {
      this.push(event.lane, `Release ${LABELS[event.result]}`, songTimeMs);
    }
  }

  prune(songTimeMs: number): void {
    this.popups = this.popups.filter(
      (popup) => popup.expiresAtMs > songTimeMs,
    );
  }

  getPopups(): readonly JudgmentPopup[] {
    return this.popups;
  }

  reset(): void {
    this.popups = [];
    this.nextId = 0;
  }

  private push(lane: number, label: string, songTimeMs: number): void {
    this.popups.push({
      id: this.nextId++,
      lane,
      label,
      expiresAtMs: songTimeMs + POPUP_DURATION_MS,
    });
    if (this.popups.length > 24) {
      this.popups.splice(0, this.popups.length - 24);
    }
  }
}
