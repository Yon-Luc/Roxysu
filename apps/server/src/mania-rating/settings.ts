import type { Db } from "@roxysu/db/types";
import { settings } from "@roxysu/db/schema";
import { eq } from "drizzle-orm";

import { executableSettingKey, listVersions } from "./registry";

export async function readExecutablePath(
  db: Db,
  versionId: string,
): Promise<string | null> {
  const key = executableSettingKey(versionId);
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  const value = row?.value?.trim();
  return value ? value : null;
}

export async function setExecutablePath(
  db: Db,
  versionId: string,
  path: string | null,
): Promise<void> {
  const key = executableSettingKey(versionId);
  if (!path?.trim()) {
    await db.delete(settings).where(eq(settings.key, key));
    return;
  }
  await db
    .insert(settings)
    .values({ key, value: path.trim() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: path.trim() },
    });
}

export async function readAllExecutablePaths(
  db: Db,
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  for (const version of listVersions()) {
    result[version.id] = await readExecutablePath(db, version.id);
  }
  return result;
}
