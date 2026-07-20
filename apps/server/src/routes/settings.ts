import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { settings } from "@roxysu/db/client.bun";
import { dbPlugin, type Db } from "../db";
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
  getPatternAnalysisJobState,
  startPatternAnalysisBackfill,
  stopPatternAnalysisBackfill,
} from "../map-analysis/patternAnalysisJob";
import {
  SYNC_PAUSE_WHEN_UNFOCUSED_KEY,
  SYNC_UI_FOCUSED_KEY,
} from "./system";
import {
  OSU_DATA_PATH_SETTING_KEY,
  buildResolvedOsuPaths,
  setCachedOsuDataOverride,
  validateOsuDataPath,
} from "../shared/osu-paths";

async function readOsuDataOverride(db: Db): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OSU_DATA_PATH_SETTING_KEY))
    .limit(1);
  return row?.value?.trim() ? row.value.trim() : null;
}

async function buildSettingsResponse(db: Db) {
  const formulaId = await getActiveFormulaId(db);
  const [pauseRow] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SYNC_PAUSE_WHEN_UNFOCUSED_KEY))
    .limit(1);
  const osuOverride = await readOsuDataOverride(db);
  const paths = buildResolvedOsuPaths(osuOverride);

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
    paths,
    sunnyDan: getSunnyDanJobState(db),
    patternAnalysis: getPatternAnalysisJobState(db),
  };
}

export const settingsRoutes = new Elysia({ prefix: "/settings" })
  .use(dbPlugin)
  .get("/", async ({ db }) => buildSettingsResponse(db))
  .get("/sunny-dan", ({ db }) => getSunnyDanJobState(db))
  .post("/sunny-dan/start", ({ db }) => startSunnyDanBackfill(db))
  .post("/sunny-dan/stop", ({ db }) => stopSunnyDanBackfill(db))
  .get("/pattern-analysis", ({ db }) => getPatternAnalysisJobState(db))
  .post("/pattern-analysis/start", ({ db }) => startPatternAnalysisBackfill(db))
  .post("/pattern-analysis/stop", ({ db }) => stopPatternAnalysisBackfill(db))
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

      if (body.osuDataPath !== undefined) {
        if (body.osuDataPath === null || body.osuDataPath.trim() === "") {
          await db
            .delete(settings)
            .where(eq(settings.key, OSU_DATA_PATH_SETTING_KEY));
          setCachedOsuDataOverride(null);
        } else {
          const validated = validateOsuDataPath(body.osuDataPath);
          if (!validated.ok) {
            set.status = 400;
            return { error: validated.error };
          }
          await db
            .insert(settings)
            .values({ key: OSU_DATA_PATH_SETTING_KEY, value: validated.path })
            .onConflictDoUpdate({
              target: settings.key,
              set: { value: validated.path },
            });
          setCachedOsuDataOverride(validated.path);
        }
      }

      return buildSettingsResponse(db);
    },
    {
      body: t.Object({
        masteryFormulaId: t.Optional(t.String()),
        pauseWhenUnfocused: t.Optional(t.Boolean()),
        /** Absolute lazer data dir, or null/"" to clear the override. */
        osuDataPath: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  );
