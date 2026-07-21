import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const BACKUP_PREFIX = "client.realm.";
const BACKUP_SUFFIX = ".bak";

/** Directory beside the Roxysu SQLite file for realm backups. */
export function backupsDirForDb(dbPath: string): string {
  return path.join(path.dirname(dbPath), "backups");
}

function backupFileName(isoTimestamp: string): string {
  const safe = isoTimestamp.replace(/[:.]/g, "-");
  return `${BACKUP_PREFIX}${safe}${BACKUP_SUFFIX}`;
}

/** Copy client.realm to Roxysu-managed backups; prune to keep last `keep` files. */
export function backupRealmFile(
  realmPath: string,
  dbPath: string,
  keep = 5,
): string {
  if (!existsSync(realmPath)) {
    throw new Error(`Realm file not found: ${realmPath}`);
  }

  const dir = backupsDirForDb(dbPath);
  mkdirSync(dir, { recursive: true });

  const iso = new Date().toISOString();
  const nonce = process.hrtime.bigint().toString(36);
  const dest = path.join(dir, backupFileName(`${iso}-${nonce}`));
  copyFileSync(realmPath, dest);
  pruneOldBackups(dir, keep);
  return dest;
}

function pruneOldBackups(dir: string, keep: number): void {
  const files = readdirSync(dir)
    .filter(
      (name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX),
    )
    .map((name) => {
      const full = path.join(dir, name);
      return { full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files.slice(keep)) {
    unlinkSync(file.full);
  }
}
