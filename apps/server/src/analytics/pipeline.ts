
import type { Db } from "@roxysu/db/types";
import { beatmaps, imports, scores } from "@roxysu/db/schema";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { subscribe, publish, type AppEvent } from "../shared/events";
import { runRetryEngine } from "./retry";
import { runSessionEngine } from "./session";
import { runMasteryEngine } from "./mastery/engine";
import { runStatisticsEngine } from "./statistics";

const DEBOUNCE_MS = 250;
const IMPORT_WAIT_MS = 1_000;
const IMPORT_WAIT_MAX_MS = 5 * 60_000;

let running = false;
let pending = false;
let pendingImportId: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export type AnalyticsDelta = {
  /** null → full rebuild for that dimension */
  scoreIds: string[] | null;
  beatmapIds: string[] | null;
  scoresDeleted: number;
  beatmapsDeleted: number;
  beatmapSetsDeleted: number;
  kind: string;
};

function latestImportStatus(db: Db): string | null {
  const row = db
    .select({ status: imports.status })
    .from(imports)
    .orderBy(desc(imports.id))
    .limit(1)
    .get();
  return row?.status ?? null;
}

function parseIdJson(raw: string | null): string[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
}

export function loadAnalyticsDelta(
  db: Db,
  importId?: number | null,
): AnalyticsDelta | null {
  const row = importId
    ? db
        .select()
        .from(imports)
        .where(eq(imports.id, importId))
        .limit(1)
        .get()
    : db.select().from(imports).orderBy(desc(imports.id)).limit(1).get();

  if (!row || row.status !== "success") return null;

  return {
    scoreIds: parseIdJson(row.changedScoreIds),
    beatmapIds: parseIdJson(row.changedBeatmapIds),
    scoresDeleted: row.scoresDeleted,
    beatmapsDeleted: row.beatmapsDeleted,
    beatmapSetsDeleted: row.beatmapSetsDeleted,
    kind: row.kind,
  };
}

/** Avoid racing realm-reader's write lock during an active sync. */
async function waitForIdleImport(db: Db): Promise<void> {
  const deadline = Date.now() + IMPORT_WAIT_MAX_MS;
  while (Date.now() < deadline) {
    if (latestImportStatus(db) !== "running") return;
    await new Promise((r) => setTimeout(r, IMPORT_WAIT_MS));
  }
  console.warn(
    "[analytics] import still running after wait — proceeding anyway",
  );
}

function needsFullRebuild(delta: AnalyticsDelta | null): boolean {
  if (!delta) return true;
  // Bootstrap / large full sync stores null ID lists.
  if (delta.scoreIds == null || delta.beatmapIds == null) return true;
  // Hard deletes drop rows we need for day/mapper keys — full rebuild is safer.
  if (
    delta.scoresDeleted > 0 ||
    delta.beatmapsDeleted > 0 ||
    delta.beatmapSetsDeleted > 0
  ) {
    return true;
  }
  return false;
}

async function resolveAffectedBeatmapIds(
  db: Db,
  delta: AnalyticsDelta,
): Promise<string[]> {
  const ids = new Set(delta.beatmapIds ?? []);
  if (delta.scoreIds && delta.scoreIds.length > 0) {
    for (const batch of chunk(delta.scoreIds, 500)) {
      const rows = await db
        .select({ beatmapId: scores.beatmapId })
        .from(scores)
        .where(inArray(scores.id, batch));
      for (const row of rows) {
        if (row.beatmapId) ids.add(row.beatmapId);
      }
    }
  }
  return [...ids];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function runAnalyticsPipeline(
  db: Db,
  opts?: { importId?: number | null; forceFull?: boolean },
): Promise<void> {
  if (running) {
    pending = true;
    if (opts?.importId != null) pendingImportId = opts.importId;
    return;
  }
  running = true;
  try {
    let useForceFull = opts?.forceFull === true;
    do {
      pending = false;
      const targetImportId = pendingImportId ?? opts?.importId ?? null;
      const forceFull = useForceFull && targetImportId == null;
      useForceFull = false;
      pendingImportId = null;

      await waitForIdleImport(db);
      const delta = forceFull ? null : loadAnalyticsDelta(db, targetImportId);
      const full = forceFull || needsFullRebuild(delta);

      console.log(
        `[analytics] pipeline start (${full ? "full" : "delta"}${
          targetImportId != null ? ` import=${targetImportId}` : ""
        })`,
      );

      if (full || !delta) {
        await runRetryEngine(db);
        await runSessionEngine(db);
        await runMasteryEngine(db);
        await runStatisticsEngine(db);
      } else {
        const scoresChanged = (delta.scoreIds?.length ?? 0) > 0;
        const beatmapIds = await resolveAffectedBeatmapIds(db, delta);

        if (!scoresChanged && beatmapIds.length === 0) {
          console.log("[analytics] delta empty — skip engines");
        } else if (scoresChanged) {
          // retry_index / session gaps need the global timeline.
          await runRetryEngine(db);
          await runSessionEngine(db);

          if (beatmapIds.length > 0) {
            await runMasteryEngine(db, { beatmapIds });
          } else {
            await runMasteryEngine(db);
          }
          await runStatisticsEngine(db, { scoreIds: delta.scoreIds ?? [] });
        } else {
          // Mapper username/online id may have changed on the map.
          const mapperRows = await db
            .select({ mapperOnlineId: beatmaps.mapperOnlineId })
            .from(beatmaps)
            .where(
              and(
                inArray(beatmaps.id, beatmapIds),
                isNotNull(beatmaps.mapperOnlineId),
              ),
            );
          const mapperIds = [
            ...new Set(
              mapperRows
                .map((r) => r.mapperOnlineId)
                .filter((id): id is number => id != null),
            ),
          ];
          if (mapperIds.length > 0) {
            await runStatisticsEngine(db, { mapperOnlineIds: mapperIds });
          }
        }
      }

      publish({ type: "dashboard.updated" });
      console.log("[analytics] pipeline done");
    } while (pending);
  } catch (err) {
    console.error("[analytics] pipeline error", err);
  } finally {
    running = false;
  }
}

function schedule(db: Db, importId?: number) {
  if (importId != null) pendingImportId = importId;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runAnalyticsPipeline(db, { importId: pendingImportId });
  }, DEBOUNCE_MS);
}

function shouldRun(event: AppEvent): boolean {
  return (
    event.type === "sync.finished" ||
    event.type === "score.imported" ||
    event.type === "score.updated"
  );
}

/** Subscribe to import events and run the analytics pipeline (debounced). */
export function startAnalyticsPipeline(db: Db): () => void {
  // Defer boot work so Home's first paint is not fighting a full SQLite wipe.
  // Use delta / needsFullRebuild — never forceFull on every launch.
  const BOOT_IDLE_MS = 8_000;
  setTimeout(() => {
    void runAnalyticsPipeline(db);
  }, BOOT_IDLE_MS);

  return subscribe((event) => {
    if (!shouldRun(event)) return;
    const importId =
      event.type === "sync.finished" ? event.importId : undefined;
    schedule(db, importId);
  });
}
