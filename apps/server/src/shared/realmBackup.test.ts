import {
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { backupRealmFile } from "@roxysu/realm-backup";

describe("realmBackup", () => {
  test("rotates backups to keep last 5", () => {
    const root = mkdtempSync(path.join(tmpdir(), "roxysu-backup-test-"));
    const dbPath = path.join(root, "data.sqlite");
    writeFileSync(dbPath, "");
    const realmPath = path.join(root, "client.realm");
    writeFileSync(realmPath, "realm-v0");

    for (let i = 1; i <= 6; i++) {
      writeFileSync(realmPath, `realm-v${i}`);
      backupRealmFile(realmPath, dbPath, 5);
    }

    const names = readdirSync(path.join(root, "backups")).filter((n) =>
      n.endsWith(".bak"),
    );
    expect(names.length).toBe(5);

    rmSync(root, { recursive: true, force: true });
  });
});
