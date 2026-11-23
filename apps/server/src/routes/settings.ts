import { settings } from "@roxysu/db/schema";
import {
  JOBS_ONBOARDING_COMPLETED_KEY,
  OVERLAY_HOST_ENABLED_KEY,
  OVERLAY_HOST_OUTPUT_KEY,
  OVERLAY_HOST_RESTART_KEY,
  OVERLAY_HOST_URL_KEY,
  RECOMMEND_FLN_RATIO_THRESHOLD_KEY,
  RECOMMEND_FOCUS_SETTINGS_KEY,
  RECOMMEND_LN_RATIO_THRESHOLD_KEY,
  SCORES_GAMEMODE_FILTER_KEY,
  SCORES_USERNAME_FILTER_KEY,
} from "@roxysu/db/settings-keys";
import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { APP_VERSION } from "../appVersion";
import {
  buildCalcBundleFileBytes,
  countCalcBundleEntries,
  getCalcBundleAppliedVersion,
  getCalcBundlePullState,
  pullAndApplyCalcBundle,
  uploadCalcBundleToHub,
} from "../map-analysis/calcBundle";

import { dbPlugin, type Db } from "../db-runtime";
import { runAnalyticsPipeline } from "../analytics/pipeline";
import { invalidateQueryContextCache } from "../query-language/execute";
import { invalidateScoreAutoFilterCache } from "../analytics/scoreAutoFilterCache";
import { invalidatePlayerStatsCache } from "../analytics/playerStatsCache";
import {
  buildScoresGamemodeSettings,
  normalizeScoresGamemodeFilterInput,
  readScoresGamemodeFilter,
  serializeScoresGamemodeFilter,
} from "../analytics/scoreGamemode";
import {
  buildScoresUsernameSettings,
  normalizeScoresUsernameFilterInput,
  readScoresUsernameFilter,
  serializeScoresUsernameFilter,
} from "../analytics/scoreUsername";
import { publish } from "../shared/events";
import {
  getReworkDanJobState,
  relabelReworkDan,
  startReworkDanBackfill,
  startReworkDanRecompute,
  stopReworkDanBackfill,
} from "../map-analysis/reworkDanJob";
import {
  getPatternAnalysisJobState,
  startPatternAnalysisBackfill,
  startPatternAnalysisRecompute,
  stopPatternAnalysisBackfill,
} from "../map-analysis/patternAnalysisJob";
import {
  getManiaRatingJobState,
  listVersions,
  executableSettingKey,
  readAllExecutablePaths,
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
import { assertSafeExecutablePath } from "../executablePath";
import { maniaRatingAllowedRoots } from "../mania-rating/allowedRoots";
import { parseOverlayHostUrl, parseOverlayOutput } from "../overlayUrl";
import { HOST_MAX, PATH_MAX, URL_MAX } from "../requestLimits";
import {
  DEFAULT_TOSU_HOST,
  TOSU_ENABLED_KEY,
  TOSU_EXECUTABLE_PATH_KEY,
  TOSU_HOST_KEY,
  normalizeTosuHost,
  readTosuSettings,
  restartTosuAdapter,
} from "../tosu";
import {
  DEFAULT_AXIS_THRESHOLDS,
  readAxisThresholds,
  serializeAxisThreshold,
  validateAxisThresholdsInput,
} from "../analytics/recommend/axisThresholds";
import {
  DEFAULT_FOCUS_SETTINGS,
  readFocusSettings,
  serializeFocusSettings,
  validateFocusSettingsInput,
} from "../analytics/recommend/focusSettings";

async function readOsuDataOverride(db: Db): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OSU_DATA_PATH_SETTING_KEY))
    .limit(1);
  return row?.value?.trim() ? row.value.trim() : null;
}

async function readOverlayHostUrl(db: Db): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OVERLAY_HOST_URL_KEY))
    .limit(1);
  return row?.value?.trim() ? row.value.trim() : null;
}

async function readOverlayHostOutput(db: Db): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OVERLAY_HOST_OUTPUT_KEY))
    .limit(1);
  return row?.value?.trim() ? row.value.trim() : null;
}

async function readOverlayHostEnabled(db: Db): Promise<boolean> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OVERLAY_HOST_ENABLED_KEY))
    .limit(1);
  return row?.value !== "0";
}

/** Last restart nonce (Unix ms) written by the UI's restart-overlay action. */
async function readOverlayHostRestart(db: Db): Promise<number | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OVERLAY_HOST_RESTART_KEY))
    .limit(1);
  if (row?.value == null) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

async function buildSettingsResponse(db: Db) {
  const [pauseRow] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SYNC_PAUSE_WHEN_UNFOCUSED_KEY))
    .limit(1);
  const osuOverride = await readOsuDataOverride(db);
  const paths = buildResolvedOsuPaths(osuOverride);
  const tosu = await readTosuSettings(db);
  const maniaRatingExecutables = await readAllExecutablePaths(db);
  const overlayHostUrl = await readOverlayHostUrl(db);
  const overlayHostEnabled = await readOverlayHostEnabled(db);
  const overlayHostOutput = await readOverlayHostOutput(db);
  const overlayHostRestart = await readOverlayHostRestart(db);
  const [
    scoresUsername,
    scoresGamemode,
    axisThresholds,
    recommendFocus,
    calcBundleAppliedVersion,
    onboardingRow,
  ] = await Promise.all([
    buildScoresUsernameSettings(db),
    buildScoresGamemodeSettings(db),
    readAxisThresholds(db),
    readFocusSettings(db),
    getCalcBundleAppliedVersion(db),
    db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, JOBS_ONBOARDING_COMPLETED_KEY))
      .get(),
  ]);

  return {
    sync: {
      pauseWhenUnfocused: pauseRow?.value === "1",
    },
    scores: scoresUsername,
    gamemode: scoresGamemode,
    axisThresholds: {
      ln: axisThresholds.ln,
      fln: axisThresholds.fln,
      defaults: {
        ln: DEFAULT_AXIS_THRESHOLDS.ln,
        fln: DEFAULT_AXIS_THRESHOLDS.fln,
      },
    },
    recommendFocus: {
      ...recommendFocus,
      defaults: DEFAULT_FOCUS_SETTINGS,
    },
    paths,
    overlay: {
      enabled: overlayHostEnabled,
      hostUrl: overlayHostUrl,
      output: overlayHostOutput,
      restartAt: overlayHostRestart,
    },
    tosu: {
      enabled: tosu.enabled,
      host: tosu.host,
      executablePath: tosu.executablePath,
      defaultHost: DEFAULT_TOSU_HOST,
    },
    reworkDan: getReworkDanJobState(db),
    patternAnalysis: getPatternAnalysisJobState(db),
    calcBundle: {
      appVersion: APP_VERSION,
      appliedVersion: calcBundleAppliedVersion,
      pull: getCalcBundlePullState(),
    },
    jobsOnboardingCompleted: onboardingRow?.value === "1",
    maniaRating: {
      versions: listVersions().map((v) => ({
        id: v.id,
        label: v.label,
        description: v.description,
        gitRef: v.gitRef ?? null,
        source: v.source,
        usesImport: v.source === "import",
        executableOptional: v.source === "import" || v.source === "inprocess",
        inProcess: v.source === "inprocess",
        executablePath: maniaRatingExecutables[v.id] ?? null,
      })),
      job: getManiaRatingJobState(db),
    },
  };
}

export { maniaRatingAllowedRoots } from "../mania-rating/allowedRoots";

export const settingsRoutes = new Elysia({ prefix: "/settings" })
  .use(dbPlugin)
  .get("/", async ({ db }) => buildSettingsResponse(db))
  .get("/rework-dan", ({ db }) => getReworkDanJobState(db))
  .post("/rework-dan/start", ({ db }) => startReworkDanBackfill(db))
  .post("/rework-dan/relabel", ({ db }) => ({
    relabeled: relabelReworkDan(db),
  }))
  .post("/rework-dan/recompute", ({ db }) => startReworkDanRecompute(db))
  .post("/rework-dan/stop", ({ db }) => stopReworkDanBackfill(db))
  .get("/pattern-analysis", ({ db }) => getPatternAnalysisJobState(db))
  .post("/pattern-analysis/start", ({ db }) => startPatternAnalysisBackfill(db))
  .post("/pattern-analysis/recompute", ({ db }) =>
    startPatternAnalysisRecompute(db),
  )
  .post("/pattern-analysis/stop", ({ db }) => stopPatternAnalysisBackfill(db))
  .get("/calc-bundle/status", async ({ db }) => ({
    appVersion: APP_VERSION,
    appliedVersion: await getCalcBundleAppliedVersion(db),
    pull: getCalcBundlePullState(),
    exportCount: await countCalcBundleEntries(db),
  }))
  .post("/calc-bundle/pull", async ({ db }) => pullAndApplyCalcBundle(db))
  .post(
    "/calc-bundle/export-upload",
    async ({ db, body, set }) => {
      try {
        const result = await uploadCalcBundleToHub({
          db,
          token: body.token,
          roxysuVersion: body.roxysuVersion.trim(),
          label: body.label,
        });
        return { ok: true as const, ...result };
      } catch (err) {
        set.status = 502;
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      body: t.Object({
        token: t.String({ minLength: 1 }),
        roxysuVersion: t.String({ minLength: 1, maxLength: 32 }),
        label: t.Optional(t.String({ maxLength: 100 })),
      }),
    },
  )
  .get(
    "/calc-bundle/export-file",
    async ({ db, query, set }) => {
      const version = query.version?.trim() || APP_VERSION;
      if (!/^[0-9A-Za-z._+-]{1,32}$/.test(version)) {
        set.status = 400;
        return {
          ok: false as const,
          message: `Invalid Roxysu version ${JSON.stringify(query.version ?? "")}`,
        };
      }
      try {
        const bytes = await buildCalcBundleFileBytes(db, version);
        set.headers["content-type"] = "application/gzip";
        set.headers["cache-control"] = "no-store";
        set.headers[
          "content-disposition"
        ] = `attachment; filename="calc-bundle-${version}.ndjson.gz"`;
        return bytes;
      } catch (err) {
        set.status = 409;
        return {
          ok: false as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      query: t.Object({
        version: t.Optional(t.String({ maxLength: 64 })),
      }),
    },
  )
  .post("/jobs/start-recommended", ({ db }) => {
    const rework = startReworkDanBackfill(db);
    return { rework };
  })
  .post("/jobs/stop-all", ({ db }) => {
    const rework = stopReworkDanBackfill(db);
    const pattern = stopPatternAnalysisBackfill(db);
    return { rework, pattern };
  })
  .get("/jobs/onboarding", async ({ db }) => {
    const row = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, JOBS_ONBOARDING_COMPLETED_KEY))
      .get();
    return { completed: row?.value === "1" };
  })
  .post(
    "/jobs/onboarding",
    async ({ db, body }) => {
      if (body.completed) {
        await db
          .insert(settings)
          .values({ key: JOBS_ONBOARDING_COMPLETED_KEY, value: "1" })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: "1" },
          });
      }
      if (body.startJobs) {
        await pullAndApplyCalcBundle(db);
        const rework = startReworkDanBackfill(db);
        return {
          completed: true,
          started: { rework },
        };
      }
      return { completed: body.completed === true, started: null };
    },
    {
      body: t.Object({
        completed: t.Boolean(),
        startJobs: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    "/",
    async ({ db, body, set }) => {
      // S-NEW-2: validate every present field first, then persist all of
      // them in one transaction. The old write-as-you-go handler could
      // commit earlier fields and still 400 on a later one, leaving the
      // settings store half-changed (e.g. a combined body that enabled the
      // overlay but failed on a bad monitor name).
      /**
       * Planned settings writes, applied atomically below.
       * @type {Array<{ kind: "upsert", key: string, value: string } | { kind: "delete", key: string }>}
       */
      const writes: Array<
        | { kind: "upsert"; key: string; value: string }
        | { kind: "delete"; key: string }
      > = [];
      /** Mania rating executable paths, applied in the same transaction. */
      const maniaPaths: Array<{ versionId: string; path: string | null }> = [];
      let tosuChanged = false;
      let scoresFilterChanged = false;
      let axisThresholdsChanged = false;
      let focusSettingsChanged = false;
      /** Cached osu! data-dir override action, applied after the commit. */
      let osuPathCacheAction:
        | { kind: "clear" }
        | { kind: "set"; path: string }
        | undefined;

      if (body.scoresUsernameFilter !== undefined) {
        const next = normalizeScoresUsernameFilterInput(
          body.scoresUsernameFilter,
        );
        const prev = await readScoresUsernameFilter(db);
        const nextSerialized = serializeScoresUsernameFilter(next);
        if (nextSerialized !== serializeScoresUsernameFilter(prev)) {
          writes.push({
            kind: "upsert",
            key: SCORES_USERNAME_FILTER_KEY,
            value: nextSerialized,
          });
          scoresFilterChanged = true;
        }
      }

      if (body.scoresGamemodeFilter !== undefined) {
        const next = normalizeScoresGamemodeFilterInput(
          body.scoresGamemodeFilter,
        );
        const prev = await readScoresGamemodeFilter(db);
        const nextSerialized = serializeScoresGamemodeFilter(next);
        if (nextSerialized !== serializeScoresGamemodeFilter(prev)) {
          writes.push({
            kind: "upsert",
            key: SCORES_GAMEMODE_FILTER_KEY,
            value: nextSerialized,
          });
          scoresFilterChanged = true;
        }
      }

      if (body.pauseWhenUnfocused !== undefined) {
        writes.push({
          kind: "upsert",
          key: SYNC_PAUSE_WHEN_UNFOCUSED_KEY,
          value: body.pauseWhenUnfocused ? "1" : "0",
        });
        if (!body.pauseWhenUnfocused) {
          // Clear any stuck pause so realm-reader resumes immediately.
          writes.push({
            kind: "upsert",
            key: SYNC_UI_FOCUSED_KEY,
            value: "1",
          });
        }
      }

      if (body.osuDataPath !== undefined) {
        if (body.osuDataPath === null || body.osuDataPath.trim() === "") {
          writes.push({ kind: "delete", key: OSU_DATA_PATH_SETTING_KEY });
          osuPathCacheAction = { kind: "clear" };
        } else {
          const validated = validateOsuDataPath(body.osuDataPath);
          if (!validated.ok) {
            set.status = 400;
            return { error: validated.error };
          }
          writes.push({
            kind: "upsert",
            key: OSU_DATA_PATH_SETTING_KEY,
            value: validated.path,
          });
          osuPathCacheAction = { kind: "set", path: validated.path };
        }
      }

      if (body.overlayEnabled !== undefined) {
        writes.push({
          kind: "upsert",
          key: OVERLAY_HOST_ENABLED_KEY,
          value: body.overlayEnabled ? "1" : "0",
        });
      }

      if (body.overlayOutput !== undefined) {
        const trimmed = body.overlayOutput?.trim() ?? "";
        if (!trimmed) {
          writes.push({ kind: "delete", key: OVERLAY_HOST_OUTPUT_KEY });
        } else {
          const parsed = parseOverlayOutput(trimmed);
          if (!parsed.ok) {
            set.status = 400;
            return { error: parsed.error };
          }
          writes.push({
            kind: "upsert",
            key: OVERLAY_HOST_OUTPUT_KEY,
            value: parsed.output,
          });
        }
      }

      if (body.overlayHostUrl !== undefined) {
        const trimmed = body.overlayHostUrl?.trim() ?? "";
        if (!trimmed) {
          writes.push({ kind: "delete", key: OVERLAY_HOST_URL_KEY });
        } else {
          const parsed = parseOverlayHostUrl(trimmed);
          if (!parsed.ok) {
            set.status = 400;
            return { error: parsed.error };
          }
          writes.push({
            kind: "upsert",
            key: OVERLAY_HOST_URL_KEY,
            value: parsed.url,
          });
        }
      }

      if (body.overlayRestartHost) {
        // D-NEW-1: bump past any previous nonce and past now, so rapid
        // clicks each restart exactly once. The shell records the nonce it
        // spawned under and ignores one it already applied.
        const prev = await readOverlayHostRestart(db);
        const next = Math.max(Date.now(), (prev ?? 0) + 1);
        writes.push({
          kind: "upsert",
          key: OVERLAY_HOST_RESTART_KEY,
          value: String(next),
        });
      }

      if (body.tosuEnabled !== undefined) {
        writes.push({
          kind: "upsert",
          key: TOSU_ENABLED_KEY,
          value: body.tosuEnabled ? "1" : "0",
        });
        tosuChanged = true;
      }

      if (body.tosuHost !== undefined) {
        const host = normalizeTosuHost(body.tosuHost);
        if (!host.ok) {
          set.status = 400;
          return { error: host.error };
        }
        writes.push({ kind: "upsert", key: TOSU_HOST_KEY, value: host.host });
        tosuChanged = true;
      }

      if (body.tosuExecutablePath !== undefined) {
        if (
          body.tosuExecutablePath === null ||
          body.tosuExecutablePath.trim() === ""
        ) {
          writes.push({ kind: "delete", key: TOSU_EXECUTABLE_PATH_KEY });
        } else {
          // H2 residual: tosu is a user-chosen third-party binary, so a hard
          // allowlist would break the feature. Require a runnable file and
          // reject the obviously unsafe locations (world-writable, temp).
          const checked = assertSafeExecutablePath(body.tosuExecutablePath, {
            requireExecutable: true,
            rejectWorldWritable: true,
            rejectTempDir: true,
          });
          if (!checked.ok) {
            set.status = 400;
            return { error: checked.error };
          }
          writes.push({
            kind: "upsert",
            key: TOSU_EXECUTABLE_PATH_KEY,
            value: checked.path,
          });
        }
        tosuChanged = true;
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
          if (typeof execPath !== "string" || execPath.trim() === "") {
            maniaPaths.push({ versionId, path: null });
            continue;
          }
          const checked = assertSafeExecutablePath(execPath, {
            allowedRoots: maniaRatingAllowedRoots(),
            requireExecutable: true,
          });
          if (!checked.ok) {
            set.status = 400;
            return { error: checked.error };
          }
          maniaPaths.push({ versionId, path: checked.path });
        }
      }

      if (
        body.lnRatioThreshold !== undefined ||
        body.flnRatioThreshold !== undefined
      ) {
        const current = await readAxisThresholds(db);
        const nextLn =
          body.lnRatioThreshold !== undefined
            ? body.lnRatioThreshold
            : current.ln;
        const nextFln =
          body.flnRatioThreshold !== undefined
            ? body.flnRatioThreshold
            : current.fln;
        const validated = validateAxisThresholdsInput(nextLn, nextFln);
        if (!validated.ok) {
          set.status = 400;
          return { error: validated.error };
        }
        if (
          validated.thresholds.ln !== current.ln ||
          validated.thresholds.fln !== current.fln
        ) {
          writes.push({
            kind: "upsert",
            key: RECOMMEND_LN_RATIO_THRESHOLD_KEY,
            value: serializeAxisThreshold(validated.thresholds.ln),
          });
          writes.push({
            kind: "upsert",
            key: RECOMMEND_FLN_RATIO_THRESHOLD_KEY,
            value: serializeAxisThreshold(validated.thresholds.fln),
          });
          axisThresholdsChanged = true;
        }
      }

      if (body.recommendFocus !== undefined) {
        const validated = validateFocusSettingsInput(body.recommendFocus);
        if (!validated.ok) {
          set.status = 400;
          return { error: validated.error };
        }
        const prev = await readFocusSettings(db);
        const nextJson = serializeFocusSettings(validated.settings);
        if (nextJson !== serializeFocusSettings(prev)) {
          writes.push({
            kind: "upsert",
            key: RECOMMEND_FOCUS_SETTINGS_KEY,
            value: nextJson,
          });
          focusSettingsChanged = true;
        }
      }

      // Apply: every planned write lands in one transaction, or none does.
      db.transaction((tx) => {
        for (const write of writes) {
          if (write.kind === "upsert") {
            tx.insert(settings)
              .values({ key: write.key, value: write.value })
              .onConflictDoUpdate({
                target: settings.key,
                set: { value: write.value },
              })
              .run();
          } else {
            tx.delete(settings).where(eq(settings.key, write.key)).run();
          }
        }
        for (const item of maniaPaths) {
          const key = executableSettingKey(item.versionId);
          if (item.path == null) {
            tx.delete(settings).where(eq(settings.key, key)).run();
          } else {
            tx.insert(settings)
              .values({ key, value: item.path })
              .onConflictDoUpdate({
                target: settings.key,
                set: { value: item.path },
              })
              .run();
          }
        }
      });

      // In-process caches and side effects only after the store is consistent.
      if (osuPathCacheAction?.kind === "set") {
        setCachedOsuDataOverride(osuPathCacheAction.path);
      } else if (osuPathCacheAction?.kind === "clear") {
        setCachedOsuDataOverride(null);
      }

      if (tosuChanged) {
        await restartTosuAdapter(db);
      }

      if (scoresFilterChanged) {
        invalidateScoreAutoFilterCache();
        invalidateQueryContextCache();
        void runAnalyticsPipeline(db, { forceFull: true });
        publish({ type: "dashboard.updated" });
        publish({ type: "mastery.updated" });
      } else if (axisThresholdsChanged || focusSettingsChanged) {
        invalidateQueryContextCache();
        // Skill history / skillset mix read thresholds + focus at compute time.
        invalidatePlayerStatsCache();
      }

      return buildSettingsResponse(db);
    },
    {
      body: t.Object({
        pauseWhenUnfocused: t.Optional(t.Boolean()),
        /**
         * Score username filter: "auto", "*", a username, or a list of usernames.
         */
        scoresUsernameFilter: t.Optional(
          t.Union([t.String(), t.Array(t.String())]),
        ),
        /**
         * Gamemode filter: "auto", "*", or a ruleset short name
         * (`osu` / `taiko` / `fruits` / `mania`, aliases std/ctb accepted).
         */
        scoresGamemodeFilter: t.Optional(t.String({ maxLength: 32 })),
        /** Absolute lazer data dir, or null/"" to clear the override. */
        osuDataPath: t.Optional(t.Union([t.String({ maxLength: PATH_MAX }), t.Null()])),
        /**
         * Full HUD URL for the desktop in-game overlay host, or null/"" to
         * reset to the default (#/overlay?bg=clear).
         */
        overlayHostUrl: t.Optional(t.Union([t.String({ maxLength: URL_MAX }), t.Null()])),
        /**
         * Monitor connector or model for the overlay host (`--output`).
         * Null or "" follows the osu! window.
         */
        overlayOutput: t.Optional(t.Union([t.String({ maxLength: 128 }), t.Null()])),
        /** Enable/disable the desktop in-game overlay host (Wayland). */
        overlayEnabled: t.Optional(t.Boolean()),
        /**
         * Restart the desktop in-game overlay host now (bumps the
         * `overlay.host_restart` nonce; no other setting changes).
         */
        overlayRestartHost: t.Optional(t.Boolean()),
        tosuEnabled: t.Optional(t.Boolean()),
        tosuHost: t.Optional(t.String({ maxLength: HOST_MAX })),
        /** Absolute path to tosu binary, or null/"" to clear. */
        tosuExecutablePath: t.Optional(
          t.Union([t.String({ maxLength: PATH_MAX }), t.Null()]),
        ),
        /** Mania rating lab calculator paths keyed by version id. */
        maniaRatingExecutables: t.Optional(
          t.Record(
            t.String({ maxLength: 64 }),
            t.Union([t.String({ maxLength: PATH_MAX }), t.Null()]),
          ),
        ),
        /**
         * Rice→LN classification boundary (ln_ratio 0–1). Must be &lt; fln.
         */
        lnRatioThreshold: t.Optional(t.Number()),
        /**
         * LN→FLN classification boundary (ln_ratio 0–1). Must be &gt; ln.
         */
        flnRatioThreshold: t.Optional(t.Number()),
        /** Push / Accuracy / Consistency / Deficit recommend focus settings. */
        recommendFocus: t.Optional(
          t.Object({
            push: t.Object({
              accMin: t.Number(),
              accMax: t.Number(),
              targetRatio: t.Number(),
              tolerance: t.Number(),
            }),
            accuracy: t.Object({
              accMin: t.Number(),
              accMax: t.Number(),
              targetRatio: t.Number(),
              tolerance: t.Number(),
            }),
            consistency: t.Object({
              accMin: t.Number(),
              accMax: t.Number(),
              targetRatio: t.Number(),
              tolerance: t.Number(),
            }),
            deficit: t.Object({
              targetRatio: t.Number(),
              tolerance: t.Number(),
            }),
            topPlays: t.Number(),
          }),
        ),
      }),
    },
  );
