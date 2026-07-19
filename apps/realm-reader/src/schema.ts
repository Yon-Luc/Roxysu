import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ObjectSchema } from "realm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type ExportedRealmSchema = {
  exportedAt: string;
  realmPath: string;
  schemaVersion: number;
  schema: ObjectSchema[];
};

let cached: ExportedRealmSchema | null = null;
let cachedPath: string | null = null;

export function loadOsuSchema(
  schemaPath = path.join(__dirname, "..", "schemas", "osu-client.schema.json"),
): ExportedRealmSchema {
  if (cached && cachedPath === schemaPath) return cached;
  cached = JSON.parse(readFileSync(schemaPath, "utf8")) as ExportedRealmSchema;
  cachedPath = schemaPath;
  return cached;
}

export function expectedSchemaVersion(schemaPath?: string): number {
  return loadOsuSchema(schemaPath).schemaVersion;
}
