import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { backupThenOpenForWrite } from "./backupBeforeWrite";

describe("backupThenOpenForWrite", () => {
  let root: string;
  let realmPath: string;
  let dbPath: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "roxysu-backup-before-write-"));
    realmPath = path.join(root, "client.realm");
    dbPath = path.join(root, "data.sqlite");
    writeFileSync(realmPath, "pre-write-bytes");
    writeFileSync(dbPath, "");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("copies the file before the write connection opens and matches pre-open bytes", () => {
    const events: string[] = [];
    let opens = 0;
    const result = backupThenOpenForWrite(realmPath, dbPath, {
      openForWrite: () => {
        opens += 1;
        events.push(`open#${opens}`);
        // The write connection (second open) mutates the file, like a real Realm write would.
        if (opens === 2) appendFileSync(realmPath, "-mutated-by-write");
        return { close: () => events.push(`close#${opens}`) };
      },
      backup: (src) => {
        events.push("backup");
        writeFileSync(path.join(root, "copy.bak"), readFileSync(src));
        return path.join(root, "copy.bak");
      },
    });

    expect(events).toEqual(["open#1", "close#1", "backup", "open#2"]);
    expect(readFileSync(result.backupPath, "utf8")).toBe("pre-write-bytes");
    expect(readFileSync(realmPath, "utf8")).toBe("pre-write-bytes-mutated-by-write");
  });

  test("default backup is a real pre-open copy in the backups directory", () => {
    let opens = 0;
    const result = backupThenOpenForWrite(realmPath, dbPath, {
      openForWrite: () => {
        opens += 1;
        if (opens === 2) appendFileSync(realmPath, "-mutated");
        return { close: () => {} };
      },
    });
    expect(readdirSync(path.join(root, "backups")).length).toBe(1);
    expect(readFileSync(result.backupPath, "utf8")).toBe("pre-write-bytes");
  });

  test("a locked probe fails before any backup is taken", () => {
    let backedUp = false;
    expect(() =>
      backupThenOpenForWrite(realmPath, dbPath, {
        openForWrite: () => {
          throw new Error("locked");
        },
        backup: () => {
          backedUp = true;
          return "x";
        },
      }),
    ).toThrow("locked");
    expect(backedUp).toBe(false);
  });

  test("schema mismatch closes the probe and skips the backup", () => {
    let closed = 0;
    let backedUp = false;
    expect(() =>
      backupThenOpenForWrite(realmPath, dbPath, {
        openForWrite: () => ({ close: () => (closed += 1) }),
        assertSchema: () => {
          throw new Error("schema");
        },
        backup: () => {
          backedUp = true;
          return "x";
        },
      }),
    ).toThrow("schema");
    expect(closed).toBe(1);
    expect(backedUp).toBe(false);
  });
});
