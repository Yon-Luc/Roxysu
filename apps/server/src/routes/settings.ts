import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { settings } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import {
  getActiveFormulaId,
  listFormulas,
  runMasteryEngine,
  setActiveFormulaId,
} from "../analytics/mastery/engine";
import { publish } from "../shared/events";
import {
  getSunnyDanJobState,
  startSunnyDanBackfill,
  stopSunnyDanBackfill,
} from "../map-analysis/sunnyDanJob";
import {
  SYNC_PAUSE_WHEN_UNFOCUSED_KEY,
  SYNC_UI_FOCUSED_KEY,
} from "./system";

export const settingsRoutes = new Elysia({ prefix: "/settings" })
  .use(dbPlugin)
  .get("/", async ({ db }) => {
    const formulaId = await getActiveFormulaId(db);
    const [pauseRow] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SYNC_PAUSE_WHEN_UNFOCUSED_KEY))
      .limit(1);

    return {
      mastery: {
        formulaId,
        formulas: listFormulas().map((f) => ({
          id: f.id,
          label: f.label,
          description: f.description,
        })),
      },
      sync: {
        pauseWhenUnfocused: pauseRow?.value === "1",
      },
      sunnyDan: getSunnyDanJobState(db),
    };
  })
  .get("/sunny-dan", ({ db }) => getSunnyDanJobState(db))
  .post("/sunny-dan/start", ({ db }) => startSunnyDanBackfill(db))
  .post("/sunny-dan/stop", ({ db }) => stopSunnyDanBackfill(db))
  .patch(
    "/",
    async ({ db, body, set }) => {
      if (body.masteryFormulaId) {
        try {
          await setActiveFormulaId(db, body.masteryFormulaId);
        } catch (err) {
          set.status = 400;
          return {
            error: err instanceof Error ? err.message : String(err),
          };
        }
        await runMasteryEngine(db);
        publish({ type: "dashboard.updated" });
      }

      if (body.pauseWhenUnfocused !== undefined) {
        const value = body.pauseWhenUnfocused ? "1" : "0";
        await db
          .insert(settings)
          .values({ key: SYNC_PAUSE_WHEN_UNFOCUSED_KEY, value })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value },
          });

        if (!body.pauseWhenUnfocused) {
          // Clear any stuck pause so realm-reader resumes immediately.
          await db
            .insert(settings)
            .values({ key: SYNC_UI_FOCUSED_KEY, value: "1" })
            .onConflictDoUpdate({
              target: settings.key,
              set: { value: "1" },
            });
        }
      }

      const formulaId = await getActiveFormulaId(db);
      const [pauseRow] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, SYNC_PAUSE_WHEN_UNFOCUSED_KEY))
        .limit(1);

      return {
        mastery: {
          formulaId,
          formulas: listFormulas().map((f) => ({
            id: f.id,
            label: f.label,
            description: f.description,
          })),
        },
        sync: {
          pauseWhenUnfocused: pauseRow?.value === "1",
        },
        sunnyDan: getSunnyDanJobState(db),
      };
    },
    {
      body: t.Object({
        masteryFormulaId: t.Optional(t.String()),
        pauseWhenUnfocused: t.Optional(t.Boolean()),
      }),
    },
  );
