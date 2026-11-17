import type { Db } from "@roxysu/db/types";
import { settings } from "@roxysu/db/schema";
import { eq } from "drizzle-orm";
import { HOST_MAX } from "../requestLimits";

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
  const parsedHost = hostRaw?.trim() ? normalizeTosuHost(hostRaw) : null;
  const host = parsedHost?.ok ? parsedHost.host : DEFAULT_TOSU_HOST;
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

export type TosuHostResult =
  | { ok: true; host: string }
  | { ok: false; error: string };

/**
 * Host and optional port only. A path, query, or userinfo is rejected so it
 * cannot be interpolated in front of `/files/beatmap/file`.
 */
export function normalizeTosuHost(raw: string): TosuHostResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, host: DEFAULT_TOSU_HOST };
  if (trimmed.length > HOST_MAX || /[\s\u0000]/.test(trimmed)) {
    return { ok: false, error: "tosuHost must be a host and port" };
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "tosuHost must be a host and port" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "tosuHost must not include credentials" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "tosuHost must be a host and port" };
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    return { ok: false, error: "tosuHost must not include a path" };
  }
  if (!url.hostname) {
    return { ok: false, error: "tosuHost must be a host and port" };
  }
  return { ok: true, host: url.host };
}
