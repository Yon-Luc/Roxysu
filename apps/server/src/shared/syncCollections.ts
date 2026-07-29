import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@roxysu/db/types";
import { collections, settings } from "@roxysu/db/schema";
import { SYNC_REALM_READER_PAUSED_KEY } from "@roxysu/db/settings-keys";
import { defaultDbPath } from "@roxysu/db/path";
import type {
  LazerCollectionSyncError,
  LazerCollectionSyncSuccess,
} from "@roxysu/collection-sync";
import {
  listCollectionMd5Hashes,
  parseQuery,
  QueryParseError,
} from "../query-language";

export { SYNC_REALM_READER_PAUSED_KEY };
export type { LazerCollectionSyncSuccess, LazerCollectionSyncError };

const PAUSE_SETTLE_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function realmReaderDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../realm-reader");
}

function runSyncCli(
  payloadPath: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", "src/sync-collections-once.ts", payloadPath],
      {
        cwd: realmReaderDir(),
        env: {
          ...process.env,
          DB_PATH: process.env.DB_PATH ?? defaultDbPath(),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    });
}

function parseCliResult(stdout: string): {
  ok: true;
  result: LazerCollectionSyncSuccess;
} | {
  ok: false;
  error: LazerCollectionSyncError;
} {
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("RESULT "));
  if (!line) {
    return {
      ok: false,
      error: { error: "Collection sync produced no result", code: "other" },
    };
  }

  const parsed = JSON.parse(line.slice("RESULT ".length)) as
    | ({ ok: true } & LazerCollectionSyncSuccess)
    | ({ ok: false } & LazerCollectionSyncError);

  if (parsed.ok) {
    const { ok: _ok, ...result } = parsed;
    return { ok: true, result };
  }

  return {
    ok: false,
    error: {
      error: parsed.error,
      code: parsed.code ?? "other",
    },
  };
}

export async function syncCollectionsToLazer(
  db: Db,
): Promise<
  | { ok: true; result: LazerCollectionSyncSuccess }
  | { ok: false; error: LazerCollectionSyncError }
> {
  const rows = await db.select().from(collections);

  const payloadCollections: {
    id: number;
    name: string;
    lazerCollectionId: string | null;
    md5Hashes: string[];
  }[] = [];
  let skippedNoMd5 = 0;

  for (const col of rows) {
    try {
      parseQuery(col.query);
    } catch (err) {
      if (err instanceof QueryParseError) {
        return {
          ok: false,
          error: {
            error: `Collection "${col.name}" has invalid query: ${err.message}`,
            code: "other",
          },
        };
      }
      throw err;
    }

    const { hashes, skippedNoMd5: skipped } = listCollectionMd5Hashes(
      db,
      col.query,
    );
    skippedNoMd5 += skipped;
    payloadCollections.push({
      id: col.id,
      name: col.name,
      lazerCollectionId: col.lazerCollectionId ?? null,
      md5Hashes: hashes,
    });
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), "roxysu-collection-sync-"));
  const payloadPath = path.join(tempDir, "payload.json");

  try {
    writeFileSync(
      payloadPath,
      JSON.stringify({
        collections: payloadCollections,
        skippedNoMd5,
      }),
    );

    await setSetting(db, SYNC_REALM_READER_PAUSED_KEY, "1");
    await sleep(PAUSE_SETTLE_MS);

    const { stdout, stderr, exitCode } = await runSyncCli(payloadPath);

    if (exitCode !== 0 && !stdout.includes("RESULT ")) {
      return {
        ok: false,
        error: {
          error: stderr.trim() || stdout.trim() || "Collection sync failed",
          code: "other",
        },
      };
    }

    const parsed = parseCliResult(stdout);
    if (!parsed.ok) return parsed;

    return parsed;
  } finally {
    await setSetting(db, SYNC_REALM_READER_PAUSED_KEY, "0");
    rmSync(tempDir, { recursive: true, force: true });
  }
}
