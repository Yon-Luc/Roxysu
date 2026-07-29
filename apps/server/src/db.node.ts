import { eq } from "drizzle-orm";
import { ensureDb } from "@roxysu/db/client.node";
import { settings } from "@roxysu/db/schema";
import type { Db } from "@roxysu/db/types";
import { bindDb } from "./db-runtime";
import { defaultDbPath } from "./shared/db-path";
import {
  OSU_DATA_PATH_SETTING_KEY,
  setCachedOsuDataOverride,
} from "./shared/osu-paths";

const dbPath = defaultDbPath();
export const db = ensureDb(dbPath);
bindDb(db);

export type { Db };

console.log(`[db] using ${dbPath} (node)`);

const pathRow = db
  .select()
  .from(settings)
  .where(eq(settings.key, OSU_DATA_PATH_SETTING_KEY))
  .limit(1)
  .get();
setCachedOsuDataOverride(pathRow?.value ?? null);
