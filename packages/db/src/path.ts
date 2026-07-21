import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Canonical Roxysu SQLite path shared by server and realm-reader.
 * Override with `DB_PATH`. Default: `apps/server/data.sqlite`.
 */
export function defaultDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../apps/server/data.sqlite");
}
