import { Elysia } from "elysia";
import { count, desc, max } from "drizzle-orm";
import { imports, scores, type Db } from "@roxysu/db/client.bun";
import { publish, subscribe, type AppEvent } from "./shared/events";

type PollState = {
  lastImportId: number;
  lastImportStatus: string | null;
  lastImportRowsChanged: number;
  lastImportDeletes: number;
  scoreCount: number;
  maxPlayedAt: number | null;
};

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
    })
    .from(imports)
    .orderBy(desc(imports.id))
    .limit(1);

  const [scoreRow] = await db
    .select({
      n: count(),
      maxPlayed: max(scores.playedAt),
    })
    .from(scores);

  const deletes =
    (lastImport?.scoresDeleted ?? 0) +
    (lastImport?.beatmapsDeleted ?? 0) +
    (lastImport?.beatmapSetsDeleted ?? 0);

  return {
    lastImportId: lastImport?.id ?? 0,
    lastImportStatus: lastImport?.status ?? null,
    lastImportRowsChanged: lastImport?.rowsChanged ?? 0,
    lastImportDeletes: deletes,
    scoreCount: scoreRow?.n ?? 0,
    maxPlayedAt: playedAtMs(scoreRow?.maxPlayed),
  };
}

export function startPollLoop(db: Db, intervalMs = 1500): () => void {
  let prev: PollState | null = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const next = await readState(db);
      if (prev) {
        const importAdvanced =
          next.lastImportId > prev.lastImportId ||
          (next.lastImportId === prev.lastImportId &&
            next.lastImportStatus !== prev.lastImportStatus &&
            next.lastImportStatus === "success");

        if (importAdvanced && next.lastImportStatus === "success") {
          // Always refresh status UI; only rebuild analytics when data changed.
          publish({ type: "dashboard.updated" });
          if (next.lastImportRowsChanged > 0 || next.lastImportDeletes > 0) {
            publish({ type: "sync.finished", importId: next.lastImportId });
          }
        }

        if (
          next.scoreCount > prev.scoreCount ||
          (next.maxPlayedAt != null &&
            prev.maxPlayedAt != null &&
            next.maxPlayedAt > prev.maxPlayedAt)
        ) {
          publish({ type: "score.imported", scoreCount: next.scoreCount });
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

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: AppEvent) => {
          try {
            controller.enqueue(encoder.encode(formatSse(event)));
          } catch {
            // stream closed
          }
        };

        // Initial ping so EventSource connects cleanly
        controller.enqueue(
          encoder.encode(`event: connected\ndata: {"ok":true}\n\n`),
        );

        unsubscribe = subscribe(send);

        request.signal.addEventListener("abort", () => {
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
      cancel() {
        unsubscribe?.();
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
