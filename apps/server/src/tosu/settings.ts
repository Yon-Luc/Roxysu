import { eq } from "drizzle-orm";
import { settings, type Db } from "@roxysu/db/client.bun";

export const TOSU_ENABLED_KEY = "tosu.enabled";
export const TOSU_HOST_KEY = "tosu.host";
export const TOSU_EXECUTABLE_PATH_KEY = "tosu.executable_path";

export const DEFAULT_TOSU_HOST = "127.0.0.1:24050";

export type TosuSettings = {
  enabled: boolean;
  host: string;
  executablePath: string | null;
};

async function readSetting(db: Db, key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function readTosuSettings(db: Db): Promise<TosuSettings> {
  const [enabledRaw, hostRaw, pathRaw] = await Promise.all([
    readSetting(db, TOSU_ENABLED_KEY),
    readSetting(db, TOSU_HOST_KEY),
    readSetting(db, TOSU_EXECUTABLE_PATH_KEY),
  ]);

  // Default enabled when unset so the live panel tries to connect.
  const enabled = enabledRaw == null ? true : enabledRaw === "1";
  const host = hostRaw?.trim() || DEFAULT_TOSU_HOST;
  const executablePath = pathRaw?.trim() ? pathRaw.trim() : null;

  return { enabled, host, executablePath };
}

export async function upsertSetting(
  db: Db,
  key: string,
  value: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    });
}

export async function deleteSetting(db: Db, key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

export function normalizeTosuHost(raw: string): string {
  let host = raw.trim();
  host = host.replace(/^https?:\/\//i, "");
  host = host.replace(/\/+$/, "");
  if (!host) return DEFAULT_TOSU_HOST;
  return host;
}
