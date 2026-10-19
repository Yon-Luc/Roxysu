import { backupRealmFile } from "@roxysu/realm-backup";

type Closable = { close(): void };

export type BackupBeforeWriteDeps<R extends Closable> = {
  /** Opens `client.realm` read/write; throws when lazer holds the file or the schema differs. */
  openForWrite: (realmPath: string) => R;
  /** Throws when the opened Realm schema version does not match the bundled pin. */
  assertSchema?: (realm: R) => void;
  backup?: (realmPath: string, dbPath: string) => string;
};

/**
 * Take the `client.realm` backup while no Roxysu write connection is open, then open for write.
 *
 * A short-lived probe connection runs first: it fails with the lazer-locked or schema-mismatch error
 * before anything is copied, and proves the file is idle. It is closed, the file is copied, and only
 * then is the real write connection opened. The backup is therefore a pre-write image.
 */
export function backupThenOpenForWrite<R extends Closable>(
  realmPath: string,
  dbPath: string,
  deps: BackupBeforeWriteDeps<R>,
): { realm: R; backupPath: string } {
  const backup = deps.backup ?? backupRealmFile;

  const probe = deps.openForWrite(realmPath);
  try {
    deps.assertSchema?.(probe);
  } finally {
    probe.close();
  }

  const backupPath = backup(realmPath, dbPath);
  const realm = deps.openForWrite(realmPath);
  return { realm, backupPath };
}
