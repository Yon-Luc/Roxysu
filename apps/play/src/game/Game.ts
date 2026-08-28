import type { AssetResolver } from "../assets/AssetResolver";
import type { AudioEngine } from "../audio/AudioEngine";
import { AudioClock } from "../audio/AudioClock";
import {
  bootstrapAudioEngine,
  createAudioEngine,
  type AudioBackend,
} from "../audio/createAudioEngine";
import { TimelineAudioEngine } from "../audio/TimelineAudioEngine";
import {
  loadBeatmapForPlay,
  loadBeatmapPreview,
  type LoadedBeatmap,
} from "../beatmap/BeatmapLoader";
import type {
  BeatmapInsights,
  BeatmapSummary,
  CollectionSummary,
  RoxysuAvailability,
  ScoreSummary,
} from "../database/types";
import type { PlaySessionSummary } from "../database/PlaySessionRepository";
import type { RoxysuDatabase } from "../database/RoxysuDatabase";
import { JudgmentEffects } from "../effects/JudgmentEffects";
import { GameEventBus } from "../events/GameEventBus";
import { GameplayEngine } from "../gameplay/GameplayEngine";
import { InputManager } from "../input/InputManager";
import { PreviewController } from "../preview/PreviewController";
import { SettingsStore } from "../settings/SettingsStore";
import {
  DEFAULT_PLAY_SETTINGS,
  formatKeyBindingsHint,
  HIT_POSITION_DEFAULT,
  type PlaySettings,
} from "../settings/PlaySettings";
import type { KeyBindings } from "../input/KeyBindings";
import { PlayfieldRenderer } from "../playfield/PlayfieldRenderer";
import { DEFAULT_PLAYFIELD_SKIN } from "../skin/defaultSkin";
import type { PlayfieldSkin } from "../skin/PlayfieldSkin";
import { SkinLoader, type SkinCatalogEntry } from "../skin/SkinLoader";
import { buildPlayfieldSkinLayout } from "../skin/skinLayout";
import { OSU_MANIA_HEIGHT } from "../integrations/osu-skin-ini";
import { buildPlayResult } from "../results/buildPlayResult";
import type { PlayResult } from "../results/PlayResult";
import type { RoxysuCatalog } from "../roxysu/RoxysuCatalog";
import {
  SongSelect,
  type SongSelectPage,
  type SongSelectQuery,
} from "../songselect/SongSelect";
import type { GameClock } from "./GameClock";
import { GameLoop } from "./GameLoop";
import {
  canTransition,
  createInitialGameState,
  type GamePhase,
  type GameStateSnapshot,
} from "./GameState";

export type GameEnvironment = {
  availability: RoxysuAvailability;
  osuDataPath: string;
  osuFilesAvailable: boolean;
  audioBackend: AudioBackend;
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
  readonly judgmentEffects = new JudgmentEffects();
  readonly playfield = new PlayfieldRenderer({
    lanes: LANES,
    width: PLAYFIELD_WIDTH,
    height: PLAYFIELD_HEIGHT,
    scrollSpeed: 400,
  });

  private playfieldSkin: PlayfieldSkin = DEFAULT_PLAYFIELD_SKIN;
  private skinLoader: SkinLoader | null = null;
  private skinNotice: string | null = null;
  private lastAppliedSkinPath: string | null | undefined;

  readonly settings = new SettingsStore();

  private songSelect: SongSelect | null = null;
  private catalog: RoxysuCatalog | null = null;
  private preview: PreviewController | null = null;
  private clock: GameClock;
  private audio: AudioEngine = new TimelineAudioEngine();
  private state = createInitialGameState();
  private readonly listeners = new Set<GameListener>();
  private environment: GameEnvironment | null = null;
  private removeLoopTick: (() => void) | null = null;
  private assets: AssetResolver;
  private loadedBeatmap: LoadedBeatmap | null = null;
  private countdownEndsAt = 0;
  private previewRequestId = 0;
  private audioLeadInMs = 0;

  constructor(private readonly config: GameConfig) {
    this.assets = config.assets;
    this.clock = new AudioClock(this.audio);
    this.events.subscribe((event) => {
      this.judgmentEffects.handle(event, this.getSongTimeMs());
    });
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
    return (
      this.clock.getTime() -
      this.audioLeadInMs +
      this.settings.get().userOffsetMs
    );
  }

  getKeyBindings(): KeyBindings {
    return { laneKeys: this.settings.get().laneKeys };
  }

  getKeyBindingsHint(): string {
    return formatKeyBindingsHint(this.settings.get().laneKeys);
  }

  getPlayfieldSkin(): PlayfieldSkin {
    return this.playfieldSkin;
  }

  getSkinNotice(): string | null {
    return this.skinNotice;
  }

  listSkins(): SkinCatalogEntry[] {
    return this.skinLoader?.listInstalled() ?? [];
  }

  setSkin(skinPath: string | null): PlaySettings {
    return this.updateSettings({ skinPath });
  }

  getSettings(): PlaySettings {
    return this.settings.get();
  }

  updateSettings(partial: Partial<PlaySettings>): PlaySettings {
    const next = this.settings.update(partial);
    this.applySettings(next);
    return next;
  }

  resetSettings(): PlaySettings {
    return this.updateSettings(DEFAULT_PLAY_SETTINGS);
  }

  getSetDifficulties(beatmapId: string): BeatmapSummary[] {
    const beatmap = this.config.database.getBeatmaps().getById(beatmapId);
    if (!beatmap) return [];

    return this.config.database
      .getBeatmaps()
      .getDifficulties(beatmap.setId)
      .filter(
        (entry) =>
          entry.rulesetShortName === "mania" && entry.keyCount === LANES,
      );
  }

  async previewSelectedBeatmap(beatmapId: string): Promise<void> {
    if (!this.preview || this.state.phase !== "SONG_SELECT") return;

    const requestId = ++this.previewRequestId;
    const beatmap = this.config.database.getBeatmaps().getById(beatmapId);
    if (!beatmap) return;

    const preview = await loadBeatmapPreview(beatmap, this.assets);
    if (requestId !== this.previewRequestId || this.state.phase !== "SONG_SELECT") {
      return;
    }
    if ("kind" in preview || !preview.audioPath) {
      this.preview.stop();
      return;
    }

    try {
      await this.preview.play(preview.audioPath, preview.previewTimeMs);
    } catch {
      this.preview.stop();
    }
  }

  stopPreview(): void {
    this.previewRequestId += 1;
    this.preview?.stop();
  }

  searchSongSelect(query: SongSelectQuery = {}): SongSelectPage {
    if (!this.songSelect) {
      throw new Error("Song select is not ready");
    }
    return this.songSelect.search(query);
  }

  listCollections(): CollectionSummary[] {
    return this.getCatalog().listCollections();
  }

  getBeatmapInsights(beatmapId: string): BeatmapInsights {
    return this.getCatalog().getBeatmapInsights(beatmapId);
  }

  getScoreHistory(beatmapId: string, limit = 10): ScoreSummary[] {
    return this.getCatalog().getScoreHistory(beatmapId, limit);
  }

  getPlaySessions(beatmapId: string, limit = 10): PlaySessionSummary[] {
    return this.getCatalog().getPlaySessions(beatmapId, limit);
  }

  getCatalog(): RoxysuCatalog {
    if (!this.catalog) {
      throw new Error("Roxysu catalog is not ready");
    }
    return this.catalog;
  }

  subscribe(listener: GameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async bootstrap(): Promise<GameEnvironment> {
    const { engine, backend } = await bootstrapAudioEngine();
    this.audio.dispose();
    this.audio = engine;
    this.clock = new AudioClock(this.audio);
    this.preview = new PreviewController(createAudioEngine(backend));

    const availability = this.config.database.open();

    if (availability.status === "ready") {
      this.settings.bindRepository(this.config.database.getPlaySettings());
      const settingsOverride = this.config.database
        .getSettings()
        .getOsuDataPathOverride();
      this.assets = this.config.createAssets(settingsOverride);
      this.skinLoader = new SkinLoader(this.assets.getOsuDataPath());
      this.applySettings(this.settings.get());
      this.catalog = this.config.database.getCatalog();
      this.songSelect = new SongSelect(
        this.config.database.getBeatmaps(),
        this.catalog,
        this.assets,
      );
      this.restoreLastBeatmapSelection();
    }

    const osuDataPath = this.assets.getOsuDataPath();
    const osuPathStatus = this.assets.getOsuPathStatus();
    const osuFilesAvailable = osuPathStatus.exists && osuPathStatus.hasFiles;
    if (!this.skinLoader) {
      this.skinLoader = new SkinLoader(osuDataPath);
    }

    this.environment = {
      availability,
      osuDataPath,
      osuFilesAvailable,
      audioBackend: backend,
    };

    this.transition("SONG_SELECT");
    return this.environment;
  }

  selectBeatmap(beatmapId: string): void {
    if (this.state.phase !== "SONG_SELECT") return;
    this.patch({ selectedBeatmapId: beatmapId, error: null, playResult: null });
    this.updateSettings({ lastBeatmapId: beatmapId });
    void this.previewSelectedBeatmap(beatmapId);
  }

  async start(): Promise<void> {
    if (this.state.phase === "PAUSED") {
      this.resume();
      return;
    }

    if (
      (this.state.phase !== "SONG_SELECT" && this.state.phase !== "RESULTS") ||
      !this.state.selectedBeatmapId
    ) {
      return;
    }

    this.transition("LOADING");
    this.patch({ error: null, playResult: null, countdownRemainingMs: null });
    this.judgmentEffects.reset();
    this.stopPreview();

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
      this.audio.prepareEmpty();
    }

    this.audio.seek(0);
    this.beginCountdown(loaded);
  }

  private beginCountdown(loaded: LoadedBeatmap): void {
    const settings = this.settings.get();
    const countdownMs = settings.countdownSeconds * 1000;

    if (countdownMs <= 0) {
      this.transition("COUNTDOWN");
      this.beginPlaying(loaded);
      return;
    }

    this.transition("COUNTDOWN");
    this.countdownEndsAt = performance.now() + countdownMs;
    this.patch({
      loadedBeatmapTitle: `${loaded.summary.artist ?? "?"} — ${loaded.summary.title ?? "?"}`,
      countdownRemainingMs: countdownMs,
      songTimeMs: 0,
      combo: 0,
      maxCombo: 0,
      score: 0,
      accuracy: 1,
    });
    this.ensureLoop();
  }

  private beginPlaying(loaded?: LoadedBeatmap): void {
    if (loaded) {
      this.loadedBeatmap = loaded;
    }

    this.syncPlaybackToChartStart();
    this.transition("PLAYING");
    this.clock.start();
    this.playfield.setPlaying(true);
    this.patch({
      countdownRemainingMs: null,
      songTimeMs: 0,
      combo: 0,
      maxCombo: 0,
      score: 0,
      accuracy: 1,
    });
    this.ensureLoop();
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
    this.syncPlaybackToChartStart();
    this.input.reset();
    this.judgmentEffects.reset();
    if (this.loadedBeatmap) {
      this.gameplay.load(this.loadedBeatmap.chart);
      this.playfield.loadChart(this.loadedBeatmap.playfield);
    }

    const wasPlaying = this.state.phase === "PLAYING";
    this.playfield.setSongTime(0);
    this.playfield.setPlaying(wasPlaying);

    if (wasPlaying) {
      this.clock.start();
      this.ensureLoop();
    }

    this.patch({
      songTimeMs: 0,
      combo: 0,
      maxCombo: 0,
      score: 0,
      accuracy: 1,
      playResult: null,
    });
  }

  finish(): void {
    if (this.state.phase !== "PLAYING" && this.state.phase !== "PAUSED") {
      return;
    }

    const gameplay = this.gameplay.getSnapshot(this.getSongTimeMs());
    const playResult =
      this.loadedBeatmap != null
        ? buildPlayResult(this.loadedBeatmap.summary, gameplay)
        : null;

    this.clock.pause();
    this.audio.pause();
    this.playfield.setPlaying(false);
    this.stopLoop();
    this.transition("RESULTS");
    this.patch({ playResult });

    if (playResult) {
      try {
        this.config.database
          .getPlaySessions()
          .insert(playResult.chartId, playResult);
      } catch {
        // Non-fatal: results screen still shows the in-memory play result.
      }
    }
  }

  returnToSongSelect(): void {
    this.clock.pause();
    this.audio.stop();
    this.playfield.setPlaying(false);
    this.playfield.setSongTime(0);
    this.input.reset();
    this.judgmentEffects.reset();
    this.audioLeadInMs = 0;
    this.loadedBeatmap = null;
    this.stopLoop();
    this.stopPreview();
    this.transition("SONG_SELECT");
    this.patch({
      songTimeMs: 0,
      combo: 0,
      maxCombo: 0,
      score: 0,
      accuracy: 1,
      loadedBeatmapTitle: null,
      playResult: null,
      countdownRemainingMs: null,
    });
  }

  dispose(): void {
    this.stopLoop();
    this.clock.pause();
    this.audio.stop();
    this.audio.dispose();
    this.preview?.dispose();
    this.preview = null;
    this.playfield.destroy();
    this.events.clear();
    this.judgmentEffects.reset();
    this.settings.flush();
    this.config.database.close();
    this.listeners.clear();
  }

  private ensureLoop(): void {
    if (this.removeLoopTick) return;

    this.removeLoopTick = this.loop.addTick(() => {
      if (this.state.phase === "COUNTDOWN") {
        const remaining = Math.max(0, this.countdownEndsAt - performance.now());
        if (remaining <= 0) {
          this.beginPlaying();
        } else {
          this.patch({ countdownRemainingMs: remaining });
        }
        return;
      }

      if (this.state.phase !== "PLAYING") return;

      const timeMs = this.getSongTimeMs();
      const inputEvents = this.input.drain();
      this.gameplay.update(timeMs, inputEvents, this.events);
      this.playfield.setHiddenMask(this.gameplay.getHiddenMask());
      this.playfield.setSongTime(timeMs);
      this.judgmentEffects.prune(timeMs);

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

  private applySettings(settings: PlaySettings): void {
    this.playfield.setScrollSpeed(settings.scrollSpeed);
    this.audio.setVolume(settings.masterVolume);
    this.preview?.setVolume(settings.masterVolume);
    this.input.setBindings({ laneKeys: settings.laneKeys });
    const skinChanged = settings.skinPath !== this.lastAppliedSkinPath;
    if (skinChanged) {
      this.applySkinFromSettings(settings.skinPath);
    }
    this.syncPlayfieldLayout(settings);
  }

  private syncPlayfieldLayout(settings: PlaySettings): void {
    const hitPosition =
      settings.hitPosition ??
      (this.playfieldSkin.maniaLayout
        ? this.playfieldSkin.maniaLayout.hitPositionPx / OSU_MANIA_HEIGHT
        : HIT_POSITION_DEFAULT);

    const layout = buildPlayfieldSkinLayout({
      width: PLAYFIELD_WIDTH,
      height: PLAYFIELD_HEIGHT,
      keys: LANES,
      maniaLayout: this.playfieldSkin.maniaLayout,
      sprites: this.playfieldSkin.sprites,
      spriteSizes: this.playfieldSkin.spriteSizes,
      align: settings.playfieldAlign,
      hitPosition,
    });

    this.playfield.setColumnLayout(layout.columns);
    this.playfield.setReceptorY(layout.receptorY);
  }

  private applySkinFromSettings(skinPath: string | null): void {
    this.lastAppliedSkinPath = skinPath;
    if (!this.skinLoader) {
      this.playfieldSkin = { ...DEFAULT_PLAYFIELD_SKIN };
      this.skinNotice = null;
      return;
    }

    const result = this.skinLoader.load(skinPath, LANES);
    if (!result.ok) {
      this.playfieldSkin = { ...DEFAULT_PLAYFIELD_SKIN };
      this.skinNotice = result.error;
      this.patch({ frameVersion: this.state.frameVersion + 1 });
      return;
    }

    this.playfieldSkin = result.skin;
    this.skinNotice = result.warnings[0] ?? null;
    this.patch({ frameVersion: this.state.frameVersion + 1 });
  }

  private syncPlaybackToChartStart(): void {
    const leadIn = this.loadedBeatmap?.general.audioLeadInMs ?? 0;
    this.audioLeadInMs = leadIn;
    this.clock.seek(leadIn);
    if (this.audio.isLoaded()) {
      this.audio.seek(leadIn);
    }
  }

  private restoreLastBeatmapSelection(): void {
    const { lastBeatmapId } = this.settings.get();
    if (!lastBeatmapId) return;

    const beatmap = this.config.database.getBeatmaps().getById(lastBeatmapId);
    if (
      !beatmap ||
      beatmap.rulesetShortName !== "mania" ||
      beatmap.keyCount !== LANES
    ) {
      return;
    }

    this.patch({ selectedBeatmapId: lastBeatmapId });
    void this.previewSelectedBeatmap(lastBeatmapId);
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
