import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { ensureDb, settings, type Db } from "@roxysu/db/client.bun";
import { defaultDbPath } from "./shared/db-path";
import {
  OSU_DATA_PATH_SETTING_KEY,
  setCachedOsuDataOverride,
} from "./shared/osu-paths";

const dbPath = defaultDbPath();
export const db = ensureDb(dbPath);

export type { Db };

export const dbPlugin = new Elysia({ name: "db" }).decorate("db", db);

console.log(`[db] using ${dbPath}`);

// Hydrate path override so covers/audio see settings before the first request.
const [pathRow] = await db
  .select()
  .from(settings)
  .where(eq(settings.key, OSU_DATA_PATH_SETTING_KEY))
  .limit(1);
setCachedOsuDataOverride(pathRow?.value ?? null);
