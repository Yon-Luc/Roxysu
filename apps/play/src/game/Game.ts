import type { AssetResolver } from "../assets/AssetResolver";
import type { AssetAvailability } from "../assets/AssetResolver";
import type { BeatmapSummary, RoxysuAvailability } from "../database/types";
import type { RoxysuDatabase } from "../database/RoxysuDatabase";
import { WallClock } from "./GameClock";
import { GameLoop } from "./GameLoop";
import {
  canTransition,
  createInitialGameState,
  type GamePhase,
  type GameStateSnapshot,
} from "./GameState";

export type SampleBeatmap = BeatmapSummary & {
  beatmapAsset: AssetAvailability | null;
};

export type GameEnvironment = {
  availability: RoxysuAvailability;
  osuDataPath: string;
  osuFilesAvailable: boolean;
  sampleBeatmaps: SampleBeatmap[];
};

export type GameConfig = {
  database: RoxysuDatabase;
  assets: AssetResolver;
  createAssets: (osuDataPathOverride: string | null) => AssetResolver;
};

type GameListener = (snapshot: GameStateSnapshot) => void;

export class Game {
  readonly clock = new WallClock();
  readonly loop = new GameLoop();

  private state = createInitialGameState();
  private readonly listeners = new Set<GameListener>();
  private environment: GameEnvironment | null = null;
  private removeLoopTick: (() => void) | null = null;
  private assets: AssetResolver;

  constructor(private readonly config: GameConfig) {
    this.assets = config.assets;
  }

  getSnapshot(): GameStateSnapshot {
    return { ...this.state };
  }

  getEnvironment(): GameEnvironment | null {
    return this.environment;
  }

  subscribe(listener: GameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async bootstrap(): Promise<GameEnvironment> {
    const availability = this.config.database.open();

    if (availability.status === "ready") {
      const settingsOverride = this.config.database
        .getSettings()
        .getOsuDataPathOverride();
      this.assets = this.config.createAssets(settingsOverride);
    }

    const osuDataPath = this.assets.getOsuDataPath();
    const osuPathStatus = this.assets.getOsuPathStatus();
    const osuFilesAvailable = osuPathStatus.exists && osuPathStatus.hasFiles;

    let sampleBeatmaps: SampleBeatmap[] = [];
    if (availability.status === "ready") {
      sampleBeatmaps = this.config.database
        .getBeatmaps()
        .search({ ruleset: "mania", keys: 7, limit: 8 })
        .map((beatmap) => ({
          ...beatmap,
          beatmapAsset: beatmap.hash
            ? this.assets.resolveBeatmap(beatmap.hash)
            : null,
        }));
    }

    this.environment = {
      availability,
      osuDataPath,
      osuFilesAvailable,
      sampleBeatmaps,
    };

    this.transition("SONG_SELECT");
    return this.environment;
  }

  selectBeatmap(beatmapId: string): void {
    if (this.state.phase !== "SONG_SELECT") return;
    this.patch({ selectedBeatmapId: beatmapId });
  }

  start(): void {
    if (this.state.phase === "SONG_SELECT" && this.state.selectedBeatmapId) {
      this.transition("LOADING");
      this.transition("COUNTDOWN");
      this.transition("PLAYING");
      this.clock.start();
      this.ensureLoop();
      return;
    }

    if (this.state.phase === "PAUSED") {
      this.resume();
    }
  }

  pause(): void {
    if (this.state.phase !== "PLAYING") return;
    this.clock.pause();
    this.transition("PAUSED");
  }

  resume(): void {
    if (this.state.phase !== "PAUSED") return;
    this.clock.resume();
    this.transition("PLAYING");
    this.ensureLoop();
  }

  restart(): void {
    this.clock.pause();
    this.clock.seek(0);
    if (this.state.phase === "PLAYING" || this.state.phase === "PAUSED") {
      this.transition("COUNTDOWN");
      this.transition("PLAYING");
      this.clock.start();
      this.ensureLoop();
    }
  }

  finish(): void {
    if (
      this.state.phase !== "PLAYING" &&
      this.state.phase !== "PAUSED"
    ) {
      return;
    }

    this.clock.pause();
    this.stopLoop();
    this.transition("RESULTS");
  }

  returnToSongSelect(): void {
    this.clock.pause();
    this.clock.seek(0);
    this.stopLoop();
    this.transition("SONG_SELECT");
  }

  dispose(): void {
    this.stopLoop();
    this.clock.pause();
    this.config.database.close();
    this.listeners.clear();
  }

  private ensureLoop(): void {
    if (this.removeLoopTick) return;

    this.removeLoopTick = this.loop.addTick(() => {
      if (this.state.phase !== "PLAYING") return;
      // M1: loop exists to validate lifecycle separation from React/GPUIX.
      void this.clock.getTime();
    });

    if (!this.loop.isRunning()) {
      this.loop.start();
    }
  }

  private stopLoop(): void {
    if (this.removeLoopTick) {
      this.removeLoopTick();
      this.removeLoopTick = null;
    }
    this.loop.stop();
  }

  private transition(phase: GamePhase): void {
    if (!canTransition(this.state.phase, phase)) {
      throw new Error(`Invalid game transition: ${this.state.phase} -> ${phase}`);
    }
    this.patch({ phase });
  }

  private patch(partial: Partial<GameStateSnapshot>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
