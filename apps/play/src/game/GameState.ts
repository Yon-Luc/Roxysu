import type { PlayResult } from "../results/PlayResult";

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
  songTimeMs: number;
  combo: number;
  maxCombo: number;
  score: number;
  accuracy: number;
  frameVersion: number;
  loadedBeatmapTitle: string | null;
  playResult: PlayResult | null;
  countdownRemainingMs: number | null;
};

export function createInitialGameState(): GameStateSnapshot {
  return {
    phase: "BOOT",
    selectedBeatmapId: null,
    error: null,
    songTimeMs: 0,
    combo: 0,
    maxCombo: 0,
    score: 0,
    accuracy: 1,
    frameVersion: 0,
    loadedBeatmapTitle: null,
    playResult: null,
    countdownRemainingMs: null,
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
