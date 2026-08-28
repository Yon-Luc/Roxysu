import { eq, playSettings, type Db } from "../integrations/roxysu-db";
import {
  clampPlaySettings,
  DEFAULT_PLAY_SETTINGS,
  type PlaySettings,
} from "../settings/PlaySettings";

const SINGLETON_ID = 1;

function toSettings(row: typeof playSettings.$inferSelect): PlaySettings {
  return clampPlaySettings({
    scrollSpeed: row.scrollSpeed,
    masterVolume: row.masterVolume,
    countdownSeconds: row.countdownSeconds,
    userOffsetMs: row.userOffsetMs,
  });
}

export class PlaySettingsRepository {
  constructor(private readonly db: Db) {}

  load(): PlaySettings {
    const row = this.db
      .select()
      .from(playSettings)
      .where(eq(playSettings.id, SINGLETON_ID))
      .limit(1)
      .get();

    return row ? toSettings(row) : { ...DEFAULT_PLAY_SETTINGS };
  }

  save(settings: PlaySettings): void {
    const values = clampPlaySettings(settings);
    const updatedAt = new Date();

    this.db
      .insert(playSettings)
      .values({
        id: SINGLETON_ID,
        scrollSpeed: values.scrollSpeed,
        masterVolume: values.masterVolume,
        countdownSeconds: values.countdownSeconds,
        userOffsetMs: values.userOffsetMs,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: playSettings.id,
        set: {
          scrollSpeed: values.scrollSpeed,
          masterVolume: values.masterVolume,
          countdownSeconds: values.countdownSeconds,
          userOffsetMs: values.userOffsetMs,
          updatedAt,
        },
      })
      .run();
  }
}
