import path from "node:path";
import { fileURLToPath } from "node:url";

export function defaultDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../data.sqlite");
}
