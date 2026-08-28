import { existsSync } from "node:fs";
import {
  closeDb,
  ensureDb,
  defaultDbPath,
  type Db,
} from "../integrations/roxysu-db";
import { BeatmapInsightsRepository } from "./BeatmapInsightsRepository";
import { BeatmapRepository } from "./BeatmapRepository";
import { CollectionRepository } from "./CollectionRepository";
import { MasteryRepository } from "./MasteryRepository";
import { PlaySessionRepository } from "./PlaySessionRepository";
import { PlaySettingsRepository } from "./PlaySettingsRepository";
import { ScoreRepository } from "./ScoreRepository";
import { SettingsRepository } from "./SettingsRepository";
import type { RoxysuAvailability } from "./types";
import { RoxysuCatalog } from "../roxysu/RoxysuCatalog";

export class RoxysuDatabase {
  private db: Db | null = null;
  private beatmaps: BeatmapRepository | null = null;
  private scores: ScoreRepository | null = null;
  private settings: SettingsRepository | null = null;
  private playSettings: PlaySettingsRepository | null = null;
  private playSessions: PlaySessionRepository | null = null;
  private mastery: MasteryRepository | null = null;
  private insights: BeatmapInsightsRepository | null = null;
  private collections: CollectionRepository | null = null;
  private catalog: RoxysuCatalog | null = null;
  private availability: RoxysuAvailability | null = null;

  constructor(private readonly dbPath: string = defaultDbPath()) {}

  get path(): string {
    return this.dbPath;
  }

  open(): RoxysuAvailability {
    if (this.availability) {
      return this.availability;
    }
    if (!existsSync(this.dbPath)) {
      this.availability = {
        status: "unavailable",
        dbPath: this.dbPath,
        reason: "db_missing",
        message:
          "Roxysu database not found. Install Roxysu and sync your osu!lazer library.",
      };
      return this.availability;
    }

    try {
      this.db = ensureDb(this.dbPath);
      this.beatmaps = new BeatmapRepository(this.db);
      this.scores = new ScoreRepository(this.db);
      this.settings = new SettingsRepository(this.db);
      this.playSettings = new PlaySettingsRepository(this.db);
      this.playSessions = new PlaySessionRepository(this.db);
      this.mastery = new MasteryRepository(this.db);
      this.insights = new BeatmapInsightsRepository(this.db);
      this.collections = new CollectionRepository(this.db);
      this.catalog = new RoxysuCatalog(
        this.scores,
        this.insights,
        this.collections,
        this.playSessions,
      );
    } catch {
      this.availability = {
        status: "unavailable",
        dbPath: this.dbPath,
        reason: "db_unreadable",
        message: "Roxysu database exists but could not be opened.",
      };
      return this.availability;
    }

    const beatmapCount = this.beatmaps.count();
    if (beatmapCount === 0) {
      this.availability = {
        status: "empty",
        dbPath: this.dbPath,
        message:
          "Roxysu is installed, but no beatmaps are synchronized yet. Sync Roxysu with osu!lazer.",
      };
      return this.availability;
    }

    const maniaBeatmapCount = this.beatmaps.count({ ruleset: "mania" });
    const mania7kBeatmapCount = this.beatmaps.count({
      ruleset: "mania",
      keys: 7,
    });

    this.availability = {
      status: "ready",
      dbPath: this.dbPath,
      beatmapCount,
      maniaBeatmapCount,
      mania7kBeatmapCount,
    };
    return this.availability;
  }

  requireOpen(): void {
    if (
      !this.db ||
      !this.beatmaps ||
      !this.scores ||
      !this.settings ||
      !this.playSettings ||
      !this.playSessions ||
      !this.mastery ||
      !this.insights ||
      !this.collections ||
      !this.catalog
    ) {
      throw new Error("RoxysuDatabase is not open");
    }
  }

  getBeatmaps(): BeatmapRepository {
    this.requireOpen();
    return this.beatmaps!;
  }

  getScores(): ScoreRepository {
    this.requireOpen();
    return this.scores!;
  }

  getSettings(): SettingsRepository {
    this.requireOpen();
    return this.settings!;
  }

  getPlaySettings(): PlaySettingsRepository {
    this.requireOpen();
    return this.playSettings!;
  }

  getPlaySessions(): PlaySessionRepository {
    this.requireOpen();
    return this.playSessions!;
  }

  getCatalog(): RoxysuCatalog {
    this.requireOpen();
    return this.catalog!;
  }

  close(): void {
    if (this.db) {
      closeDb(this.db);
      this.db = null;
      this.beatmaps = null;
      this.scores = null;
      this.settings = null;
      this.playSettings = null;
      this.playSessions = null;
      this.mastery = null;
      this.insights = null;
      this.collections = null;
      this.catalog = null;
      this.availability = null;
    }
  }
}
