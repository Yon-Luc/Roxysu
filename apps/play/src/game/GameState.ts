export type GamePhase =
  | "BOOT"
  | "SONG_SELECT"
  | "LOADING"
  | "COUNTDOWN"
  | "PLAYING"
  | "PAUSED"
  | "RESULTS";

export type GameStateSnapshot = {
  phase: GamePhase;
  selectedBeatmapId: string | null;
  error: string | null;
};

export function createInitialGameState(): GameStateSnapshot {
  return {
    phase: "BOOT",
    selectedBeatmapId: null,
    error: null,
  };
}

export function canTransition(from: GamePhase, to: GamePhase): boolean {
  switch (from) {
    case "BOOT":
      return to === "SONG_SELECT";
    case "SONG_SELECT":
      return to === "LOADING";
    case "LOADING":
      return to === "COUNTDOWN" || to === "SONG_SELECT";
    case "COUNTDOWN":
      return to === "PLAYING" || to === "SONG_SELECT";
    case "PLAYING":
      return to === "PAUSED" || to === "RESULTS" || to === "SONG_SELECT";
    case "PAUSED":
      return to === "PLAYING" || to === "SONG_SELECT" || to === "RESULTS";
    case "RESULTS":
      return to === "SONG_SELECT" || to === "LOADING";
    default:
      return false;
  }
}
