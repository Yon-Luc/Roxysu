import {
  clampPlaySettings,
  DEFAULT_PLAY_SETTINGS,
  type PlaySettings,
} from "./PlaySettings";

type SettingsListener = (settings: PlaySettings) => void;

export class SettingsStore {
  private settings = { ...DEFAULT_PLAY_SETTINGS };
  private readonly listeners = new Set<SettingsListener>();

  get(): PlaySettings {
    return { ...this.settings };
  }

  update(partial: Partial<PlaySettings>): PlaySettings {
    this.settings = clampPlaySettings({ ...this.settings, ...partial });
    this.emit();
    return this.get();
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.get();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
