import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collections, settings, type Db } from "@roxysu/db/client.bun";
import {
  listCollectionMd5Hashes,
  parseQuery,
  QueryParseError,
} from "../query-language";

export const SYNC_REALM_READER_PAUSED_KEY = "sync.realm_reader_paused";

const PAUSE_SETTLE_MS = 2_000;

export type LazerCollectionSyncSuccess = {
  created: number;
  updated: number;
  deleted: number;
  skippedNoMd5: number;
  backupPath: string;
  syncedAt: string;
};

export type LazerCollectionSyncError = {
  error: string;
  code: "locked" | "schema_mismatch" | "other";
};

function realmReaderDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../realm-reader");
}

function defaultDbPathFromServer(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../data.sqlite");
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
    await Bun.sleep(PAUSE_SETTLE_MS);

    const proc = Bun.spawn({
      cmd: [
        "bunx",
        "tsx",
        "src/sync-collections-once.ts",
        payloadPath,
      ],
      cwd: realmReaderDir(),
      env: {
        ...process.env,
        DB_PATH: process.env.DB_PATH ?? defaultDbPathFromServer(),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

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
