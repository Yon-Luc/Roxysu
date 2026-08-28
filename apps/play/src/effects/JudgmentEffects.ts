import type { GameEvent } from "../events/GameEventBus";
import type { JudgmentResult } from "../integrations/mania-judge";
import type { PlayfieldSkin } from "../skin/PlayfieldSkin";

export type JudgmentPopup = {
  id: number;
  lane: number;
  label: string;
  result: JudgmentResult | "miss";
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

function resolvePopupColor(
  skin: PlayfieldSkin,
  result: JudgmentResult | "miss",
): string {
  if (result === "miss") {
    return skin.judgmentMissColor;
  }
  return skin.judgmentColors[result] ?? skin.judgmentLineColor;
}

export class JudgmentEffects {
  private popups: JudgmentPopup[] = [];
  private nextId = 0;

  handle(event: GameEvent, songTimeMs: number): void {
    if (event.type === "NoteHit") {
      this.push(event.lane, LABELS[event.result], event.result, songTimeMs);
      return;
    }
    if (event.type === "NoteMiss") {
      this.push(event.lane, "Miss", "miss", songTimeMs);
      return;
    }
    if (event.type === "HoldCompleted" && event.result !== "miss") {
      this.push(
        event.lane,
        `Release ${LABELS[event.result]}`,
        event.result,
        songTimeMs,
      );
    }
  }

  prune(songTimeMs: number): void {
    this.popups = this.popups.filter(
      (popup) => popup.expiresAtMs > songTimeMs,
    );
  }

  getPopups(skin: PlayfieldSkin): Array<JudgmentPopup & { color: string }> {
    return this.popups.map((popup) => ({
      ...popup,
      color: resolvePopupColor(skin, popup.result),
    }));
  }

  reset(): void {
    this.popups = [];
    this.nextId = 0;
  }

  private push(
    lane: number,
    label: string,
    result: JudgmentResult | "miss",
    songTimeMs: number,
  ): void {
    this.popups.push({
      id: this.nextId++,
      lane,
      label,
      result,
      expiresAtMs: songTimeMs + POPUP_DURATION_MS,
    });
    if (this.popups.length > 24) {
      this.popups.splice(0, this.popups.length - 24);
    }
  }
}
