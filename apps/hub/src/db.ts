import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "@roxysu/db/hub";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const dbPath = process.env.DATABASE_URL ?? "./data/hub.sqlite";

// Ensure the directory exists (important for the Docker volume mount)
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath, { create: true });

// Enable WAL mode for better concurrent read performance
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle(sqlite, { schema });

// Run migrations on startup — safe to call every time (idempotent)
export function runMigrations() {
  try {
    migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[hub] DB migrations applied");
  } catch (err) {
    console.error("[hub] Migration error:", err);
    process.exit(1);
  }
}

if (import.meta.main) {
  runMigrations();
}
