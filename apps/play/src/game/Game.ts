import type { AssetResolver } from "../assets/AssetResolver";
import type { AssetAvailability } from "../assets/AssetResolver";
import { AudioClock } from "../audio/AudioClock";
import { TimelineAudioEngine } from "../audio/TimelineAudioEngine";
import {
  loadBeatmapForPlay,
  type LoadedBeatmap,
} from "../beatmap/BeatmapLoader";
import type { BeatmapSummary, RoxysuAvailability } from "../database/types";
import type { RoxysuDatabase } from "../database/RoxysuDatabase";
import { GameEventBus } from "../events/GameEventBus";
import { GameplayEngine } from "../gameplay/GameplayEngine";
import { InputManager } from "../input/InputManager";
import { PlayfieldRenderer } from "../playfield/PlayfieldRenderer";
import type { GameClock } from "./GameClock";
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

const PLAYFIELD_WIDTH = 700;
const PLAYFIELD_HEIGHT = 680;
const LANES = 7;

export class Game {
  readonly loop = new GameLoop();
  readonly events = new GameEventBus();
  readonly input = new InputManager();
  readonly gameplay = new GameplayEngine();
  readonly playfield = new PlayfieldRenderer({
    lanes: LANES,
    width: PLAYFIELD_WIDTH,
    height: PLAYFIELD_HEIGHT,
    scrollSpeed: 400,
  });

  private clock: GameClock;
  private readonly audio = new TimelineAudioEngine();
  private state = createInitialGameState();
  private readonly listeners = new Set<GameListener>();
  private environment: GameEnvironment | null = null;
  private removeLoopTick: (() => void) | null = null;
  private assets: AssetResolver;
  private loadedBeatmap: LoadedBeatmap | null = null;

  constructor(private readonly config: GameConfig) {
    this.assets = config.assets;
    this.clock = new AudioClock(this.audio);
  }

  getSnapshot(): GameStateSnapshot {
    return { ...this.state };
  }

  getEnvironment(): GameEnvironment | null {
    return this.environment;
  }

  getLoadedBeatmap(): LoadedBeatmap | null {
    return this.loadedBeatmap;
  }

  getSongTimeMs(): number {
    return this.clock.getTime();
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
    this.patch({ selectedBeatmapId: beatmapId, error: null });
  }

  async start(): Promise<void> {
    if (this.state.phase === "PAUSED") {
      this.resume();
      return;
    }

    if (this.state.phase !== "SONG_SELECT" || !this.state.selectedBeatmapId) {
      return;
    }

    this.transition("LOADING");
    this.patch({ error: null });

    const beatmap = this.config.database
      .getBeatmaps()
      .getById(this.state.selectedBeatmapId);

    if (!beatmap) {
      this.patch({
        error: "Selected beatmap was not found in the Roxysu catalog",
      });
      this.transition("SONG_SELECT");
      return;
    }

    const loaded = await loadBeatmapForPlay(beatmap, this.assets);
    if ("kind" in loaded) {
      this.patch({ error: loaded.message });
      this.transition("SONG_SELECT");
      return;
    }

    this.loadedBeatmap = loaded;
    this.gameplay.load(loaded.chart);
    this.playfield.loadChart(loaded.playfield);
    this.input.reset();

    if (loaded.audioPath) {
      try {
        await this.audio.load(loaded.audioPath);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load audio";
        this.patch({ error: message });
        this.transition("SONG_SELECT");
        return;
      }
    } else {
      this.audio.markTimelineReady();
    }

    this.audio.seek(0);
    this.transition("COUNTDOWN");
    this.transition("PLAYING");

    this.clock.seek(0);
    this.clock.start();
    this.playfield.setPlaying(true);
    this.ensureLoop();
    this.patch({
      loadedBeatmapTitle: `${loaded.summary.artist ?? "?"} — ${loaded.summary.title ?? "?"}`,
      songTimeMs: 0,
      combo: 0,
      maxCombo: 0,
      score: 0,
      accuracy: 1,
    });
  }

  pause(): void {
    if (this.state.phase !== "PLAYING") return;
    this.clock.pause();
    this.playfield.setPlaying(false);
    this.transition("PAUSED");
  }

  resume(): void {
    if (this.state.phase !== "PAUSED") return;
    this.clock.resume();
    this.playfield.setPlaying(true);
    this.transition("PLAYING");
    this.ensureLoop();
  }

  restart(): void {
    if (this.state.phase !== "PLAYING" && this.state.phase !== "PAUSED") {
      return;
    }

    this.clock.pause();
    this.clock.seek(0);
    this.audio.stop();
    this.audio.seek(0);
    this.input.reset();
    if (this.loadedBeatmap) {
      this.gameplay.load(this.loadedBeatmap.chart);
    }

    const wasPlaying = this.state.phase === "PLAYING";
    this.playfield.setSongTime(0);
    this.playfield.setPlaying(wasPlaying);

    if (wasPlaying) {
      this.clock.start();
      this.audio.play();
      this.ensureLoop();
    }

    this.patch({
      songTimeMs: 0,
      combo: 0,
      maxCombo: 0,
      score: 0,
      accuracy: 1,
    });
  }

  finish(): void {
    if (this.state.phase !== "PLAYING" && this.state.phase !== "PAUSED") {
      return;
    }

    this.clock.pause();
    this.audio.pause();
    this.playfield.setPlaying(false);
    this.stopLoop();
    this.transition("RESULTS");
  }

  returnToSongSelect(): void {
    this.clock.pause();
    this.audio.stop();
    this.playfield.setPlaying(false);
    this.playfield.setSongTime(0);
    this.input.reset();
    this.loadedBeatmap = null;
    this.stopLoop();
    this.transition("SONG_SELECT");
    this.patch({
      songTimeMs: 0,
      combo: 0,
      maxCombo: 0,
      score: 0,
      accuracy: 1,
      loadedBeatmapTitle: null,
    });
  }

  dispose(): void {
    this.stopLoop();
    this.clock.pause();
    this.audio.stop();
    this.playfield.destroy();
    this.events.clear();
    this.config.database.close();
    this.listeners.clear();
  }

  private ensureLoop(): void {
    if (this.removeLoopTick) return;

    this.removeLoopTick = this.loop.addTick(() => {
      if (this.state.phase !== "PLAYING") return;

      const timeMs = this.clock.getTime();
      const inputEvents = this.input.drain();
      this.gameplay.update(timeMs, inputEvents, this.events);
      this.playfield.setSongTime(timeMs);

      const gameplay = this.gameplay.getSnapshot(timeMs);
      this.patch({
        songTimeMs: gameplay.songTimeMs,
        combo: gameplay.combo,
        maxCombo: gameplay.maxCombo,
        score: gameplay.score,
        accuracy: gameplay.accuracy,
        frameVersion: this.state.frameVersion + 1,
      });

      if (gameplay.finished) {
        this.finish();
      }
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
