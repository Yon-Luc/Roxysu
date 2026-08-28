import {
  clampPlaySettings,
  DEFAULT_PLAY_SETTINGS,
  type PlaySettings,
} from "./PlaySettings";
import type { PlaySettingsRepository } from "../database/PlaySettingsRepository";

type SettingsListener = (settings: PlaySettings) => void;

const SAVE_DEBOUNCE_MS = 300;

export class SettingsStore {
  private settings = { ...DEFAULT_PLAY_SETTINGS };
  private readonly listeners = new Set<SettingsListener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private repository: PlaySettingsRepository | null = null) {}

  bindRepository(repository: PlaySettingsRepository): void {
    this.repository = repository;
    this.loadFromRepository();
  }

  loadFromRepository(): PlaySettings {
    if (!this.repository) {
      return this.get();
    }
    this.settings = this.repository.load();
    this.emit();
    return this.get();
  }

  get(): PlaySettings {
    return { ...this.settings };
  }

  update(partial: Partial<PlaySettings>): PlaySettings {
    this.settings = clampPlaySettings({ ...this.settings, ...partial });
    this.emit();
    this.scheduleSave();
    return this.get();
  }

  replace(settings: PlaySettings): PlaySettings {
    this.settings = clampPlaySettings(settings);
    this.emit();
    this.scheduleSave();
    return this.get();
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.repository?.save(this.settings);
  }

  private scheduleSave(): void {
    if (!this.repository) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.repository?.save(this.settings);
    }, SAVE_DEBOUNCE_MS);
  }

  private emit(): void {
    const snapshot = this.get();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
