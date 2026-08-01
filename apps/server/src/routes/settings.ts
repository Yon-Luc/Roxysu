import { settings } from "@roxysu/db/schema";
import { SCORES_USERNAME_FILTER_KEY } from "@roxysu/db/settings-keys";
import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";

import { dbPlugin, type Db } from "../db-runtime";
import {
  getActiveFormulaId,
  listFormulas,
  runMasteryEngine,
  setActiveFormulaId,
} from "../analytics/mastery/engine";
import { runAnalyticsPipeline } from "../analytics/pipeline";
import {
  buildScoresUsernameSettings,
  normalizeScoresUsernameFilterInput,
  readScoresUsernameFilter,
  serializeScoresUsernameFilter,
} from "../analytics/scoreUsername";
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
  getManiaRatingJobState,
  listVersions,
  readAllExecutablePaths,
  setExecutablePath,
} from "../mania-rating";
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
import {
  DEFAULT_TOSU_HOST,
  TOSU_ENABLED_KEY,
  TOSU_EXECUTABLE_PATH_KEY,
  TOSU_HOST_KEY,
  deleteSetting,
  normalizeTosuHost,
  readTosuSettings,
  restartTosuAdapter,
  upsertSetting,
} from "../tosu";

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
  const tosu = await readTosuSettings(db);
  const maniaRatingExecutables = await readAllExecutablePaths(db);
  const scoresUsername = await buildScoresUsernameSettings(db);

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
    scores: scoresUsername,
    paths,
    tosu: {
      enabled: tosu.enabled,
      host: tosu.host,
      executablePath: tosu.executablePath,
      defaultHost: DEFAULT_TOSU_HOST,
    },
    sunnyDan: getSunnyDanJobState(db),
    patternAnalysis: getPatternAnalysisJobState(db),
      maniaRating: {
      versions: listVersions().map((v) => ({
        id: v.id,
        label: v.label,
        description: v.description,
        gitRef: v.gitRef ?? null,
        source: v.source,
        usesImport: v.source === "import",
        executableOptional: v.source === "import",
        executablePath: maniaRatingExecutables[v.id] ?? null,
      })),
      job: getManiaRatingJobState(db),
    },
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
      let tosuChanged = false;
      let scoresUsernameChanged = false;

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

      if (body.scoresUsernameFilter !== undefined) {
        const next = normalizeScoresUsernameFilterInput(
          body.scoresUsernameFilter,
        );
        const prev = await readScoresUsernameFilter(db);
        const nextSerialized = serializeScoresUsernameFilter(next);
        const prevSerialized = serializeScoresUsernameFilter(prev);
        if (nextSerialized !== prevSerialized) {
          await upsertSetting(db, SCORES_USERNAME_FILTER_KEY, nextSerialized);
          scoresUsernameChanged = true;
        }
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

      if (body.tosuEnabled !== undefined) {
        await upsertSetting(db, TOSU_ENABLED_KEY, body.tosuEnabled ? "1" : "0");
        tosuChanged = true;
      }

      if (body.tosuHost !== undefined) {
        const host = normalizeTosuHost(body.tosuHost);
        await upsertSetting(db, TOSU_HOST_KEY, host);
        tosuChanged = true;
      }

      if (body.tosuExecutablePath !== undefined) {
        if (
          body.tosuExecutablePath === null ||
          body.tosuExecutablePath.trim() === ""
        ) {
          await deleteSetting(db, TOSU_EXECUTABLE_PATH_KEY);
        } else {
          await upsertSetting(
            db,
            TOSU_EXECUTABLE_PATH_KEY,
            body.tosuExecutablePath.trim(),
          );
        }
        tosuChanged = true;
      }

      if (tosuChanged) {
        await restartTosuAdapter(db);
      }

      if (body.maniaRatingExecutables) {
        for (const [versionId, execPath] of Object.entries(
          body.maniaRatingExecutables,
        )) {
          const version = listVersions().find((v) => v.id === versionId);
          if (!version) {
            set.status = 400;
            return { error: `Unknown mania rating version: ${versionId}` };
          }
          await setExecutablePath(
            db,
            versionId,
            typeof execPath === "string" ? execPath : null,
          );
        }
      }

      if (scoresUsernameChanged) {
        await runAnalyticsPipeline(db, { forceFull: true });
        publish({ type: "dashboard.updated" });
        publish({ type: "mastery.updated" });
      }

      return buildSettingsResponse(db);
    },
    {
      body: t.Object({
        masteryFormulaId: t.Optional(t.String()),
        pauseWhenUnfocused: t.Optional(t.Boolean()),
        /**
         * Score username filter: "auto", "*", a username, or a list of usernames.
         */
        scoresUsernameFilter: t.Optional(
          t.Union([t.String(), t.Array(t.String())]),
        ),
        /** Absolute lazer data dir, or null/"" to clear the override. */
        osuDataPath: t.Optional(t.Union([t.String(), t.Null()])),
        tosuEnabled: t.Optional(t.Boolean()),
        tosuHost: t.Optional(t.String()),
        /** Absolute path to tosu binary, or null/"" to clear. */
        tosuExecutablePath: t.Optional(t.Union([t.String(), t.Null()])),
        /** Mania rating lab calculator paths keyed by version id. */
        maniaRatingExecutables: t.Optional(
          t.Record(t.String(), t.Union([t.String(), t.Null()])),
        ),
      }),
    },
  );
