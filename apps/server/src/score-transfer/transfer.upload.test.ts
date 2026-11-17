import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { closeDb, createDb } from "@roxysu/db/client.bun";
import type { Db } from "@roxysu/db/types";
import {
  armProcessTimeout,
  previewScoreTransfer,
  scoreTransferTooLarge,
  scoreTransferUploadFile,
  sweepExpiredScoreTransferUploads,
  MAX_UPLOAD_BYTES,
} from "./transfer";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(here, "..", "..", "..", "..", "packages", "db", "drizzle");

let db: Db;
let dir: string;

function fileBytes(marker: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: "roxysu-scores",
      version: 1,
      exportedAt: "2024-01-01T00:00:00.000Z",
      scores: [
        {
          onlineId: 1,
          ruleset: "mania",
          playedAt: Date.parse("2024-01-01T00:00:00Z"),
          totalScore: 1,
          username: marker,
        },
      ],
    }),
  );
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "roxysu-transfer-upload-"));
  db = createDb(":memory:");
  migrate(db as Parameters<typeof migrate>[0], { migrationsFolder });
});

afterAll(() => {
  closeDb(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("score transfer uploads", () => {
  test("two previews keep separate files", async () => {
    const first = await previewScoreTransfer(db, fileBytes("alpha"), { dir });
    const second = await previewScoreTransfer(db, fileBytes("beta"), { dir });
    expect("error" in first).toBe(false);
    expect("error" in second).toBe(false);
    if ("error" in first || "error" in second) return;
    expect(first.uploadId).not.toBe(second.uploadId);
    const a = scoreTransferUploadFile(first.uploadId, dir);
    const b = scoreTransferUploadFile(second.uploadId, dir);
    expect(a && readFileSync(a, "utf8")).toContain("alpha");
    expect(b && readFileSync(b, "utf8")).toContain("beta");
    expect(a && existsSync(a)).toBe(true);
  });

  test("an expired upload is removed", async () => {
    const preview = await previewScoreTransfer(db, fileBytes("old"), { dir });
    if ("error" in preview) throw new Error(preview.error);
    sweepExpiredScoreTransferUploads(Date.now() + 31 * 60 * 1000, dir);
    const file = scoreTransferUploadFile(preview.uploadId, dir);
    expect(file && existsSync(file)).toBe(false);
  });

  test("size is rejected before the bytes would be parsed", () => {
    expect(scoreTransferTooLarge(MAX_UPLOAD_BYTES + 1)).toBe(true);
    expect(scoreTransferTooLarge(MAX_UPLOAD_BYTES)).toBe(false);
  });
});

describe("armProcessTimeout", () => {
  test("kills once the timer fires, and a clear cancels it", async () => {
    let killed = 0;
    const cancel = armProcessTimeout(() => {
      killed += 1;
    }, 20, () => {});
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(killed).toBe(1);

    let late = 0;
    const stop = armProcessTimeout(() => {
      late += 1;
    }, 30, () => {});
    stop();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(late).toBe(0);
    void cancel;
  });
});
