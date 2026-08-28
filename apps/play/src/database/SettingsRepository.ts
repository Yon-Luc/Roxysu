import {
  eq,
  settings,
  type Db,
} from "../integrations/roxysu-db";
import { OSU_DATA_PATH_SETTING_KEY } from "../integrations/roxysu-paths";

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  get(key: string): string | null {
    const row = this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1)
      .get();

    return row?.value ?? null;
  }

  getOsuDataPathOverride(): string | null {
    const value = this.get(OSU_DATA_PATH_SETTING_KEY);
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }
}
