import { settings } from "@roxysu/db/schema";
import { eq } from "drizzle-orm";
import type { Db } from "@roxysu/db/types";

export async function readSetting(
  db: Db,
  key: string,
): Promise<string | null> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ?? null;
}

export async function writeSetting(
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
