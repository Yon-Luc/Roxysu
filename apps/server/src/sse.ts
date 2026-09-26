import type { Db } from "@roxysu/db/types";
import { imports, scores, settings } from "@roxysu/db/schema";
import { SYNC_SCHEMA_OUTDATED_KEY } from "@roxysu/db/settings-keys";
import { Elysia } from "elysia";
import { desc, eq, max } from "drizzle-orm";

import { publish, subscribe, type AppEvent } from "./shared/events";

type PollState = {
  lastImportId: number;
  lastImportStatus: string | null;
  lastImportRowsChanged: number;
  lastImportDeletes: number;
  lastImportHasChangedIds: boolean;
  scoreCount: number;
  maxPlayedAt: number | null;
  schemaOutdated: string | null;
};

/** Latest mirror flag, so a client that connects after the poll can still hear it. */
let latestSchemaOutdated = false;

export function currentSchemaOutdated(): boolean {
  return latestSchemaOutdated;
}

function playedAtMs(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  return value;
}

async function readState(db: Db): Promise<PollState> {
  const [lastImport] = await db
    .select({
      id: imports.id,
      status: imports.status,
      rowsChanged: imports.rowsChanged,
      scoresDeleted: imports.scoresDeleted,
      beatmapsDeleted: imports.beatmapsDeleted,
      beatmapSetsDeleted: imports.beatmapSetsDeleted,
      changedScoreIds: imports.changedScoreIds,
    })
    .from(imports)
    .orderBy(desc(imports.id))
    .limit(1);

  const [scoreRow] = await db
    .select({
      maxPlayed: max(scores.playedAt),
    })
    .from(scores);

  const [schemaRow] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SYNC_SCHEMA_OUTDATED_KEY))
    .limit(1);

  const deletes =
    (lastImport?.scoresDeleted ?? 0) +
    (lastImport?.beatmapsDeleted ?? 0) +
    (lastImport?.beatmapSetsDeleted ?? 0);

  let hasChangedIds = false;
  if (lastImport?.changedScoreIds) {
    try {
      const parsed = JSON.parse(lastImport.changedScoreIds) as unknown;
      hasChangedIds = Array.isArray(parsed) && parsed.length > 0;
    } catch {
      hasChangedIds = false;
    }
  }

  return {
    lastImportId: lastImport?.id ?? 0,
    lastImportStatus: lastImport?.status ?? null,
    lastImportRowsChanged: lastImport?.rowsChanged ?? 0,
    lastImportDeletes: deletes,
    lastImportHasChangedIds: hasChangedIds,
    scoreCount: 0,
    maxPlayedAt: playedAtMs(scoreRow?.maxPlayed),
    schemaOutdated: schemaRow?.value ?? null,
  };
}

export function startPollLoop(db: Db, intervalMs = 1500): () => void {
  let prev: PollState | null = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const next = await readState(db);
      latestSchemaOutdated = next.schemaOutdated != null;
      const schemaChanged = prev
        ? next.schemaOutdated !== prev.schemaOutdated
        : next.schemaOutdated != null;
      if (schemaChanged) publish({ type: "sync.schema_outdated" });
      if (prev) {
        const importAdvanced =
          next.lastImportId > prev.lastImportId ||
          (next.lastImportId === prev.lastImportId &&
            next.lastImportStatus !== prev.lastImportStatus &&
            next.lastImportStatus === "success");

        if (importAdvanced && next.lastImportStatus === "success") {
          // Always refresh status UI; only rebuild analytics when data changed.
          publish({ type: "dashboard.updated" });
          if (
            next.lastImportRowsChanged > 0 ||
            next.lastImportDeletes > 0 ||
            next.lastImportHasChangedIds
          ) {
            publish({ type: "sync.finished", importId: next.lastImportId });
          }
        }

        if (
          next.maxPlayedAt != null &&
          (prev.maxPlayedAt == null || next.maxPlayedAt > prev.maxPlayedAt)
        ) {
          publish({ type: "score.imported", scoreCount: 0 });
          publish({ type: "dashboard.updated" });
        }
      }
      prev = next;
    } catch (err) {
      console.error("[poll] error", err);
    }
  };

  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

function formatSse(event: AppEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const sseRoutes = new Elysia({ prefix: "/api" }).get(
  "/events",
  ({ request }) => {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const cleanup = () => {
          if (heartbeat != null) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          unsubscribe?.();
          unsubscribe = null;
        };

        const send = (event: AppEvent) => {
          try {
            controller.enqueue(encoder.encode(formatSse(event)));
          } catch {
            cleanup();
          }
        };

        controller.enqueue(
          encoder.encode(
            `event: connected\ndata: ${JSON.stringify({ ok: true, schemaOutdated: currentSchemaOutdated() })}\n\n`,
          ),
        );

        unsubscribe = subscribe(send);
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            cleanup();
          }
        }, 20_000);

        request.signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
      cancel() {
        if (heartbeat != null) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        unsubscribe?.();
        unsubscribe = null;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  },
);
