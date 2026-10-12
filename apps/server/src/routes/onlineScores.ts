import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-runtime";
import { resolveHubBaseUrl } from "../hubUrl";
import {
  candidateSummary,
  commitOnlineScores,
  previewOnlineScores,
  resolveLocalOsuUser,
} from "../online-scores/pull";

const RULESETS = ["osu", "taiko", "fruits", "mania"] as const;

export const onlineScoreRoutes = new Elysia({ prefix: "/online-scores" })
  .use(dbPlugin)
  .get("/user", async ({ db }) => {
    const local = await resolveLocalOsuUser(db);
    const waiting = await candidateSummary(db);
    if ("error" in local) {
      return { ok: false, error: local.error, waiting, hubUrl: resolveHubBaseUrl() };
    }
    return { ok: true, ...local, waiting, hubUrl: resolveHubBaseUrl() };
  })
  .post(
    "/preview",
    async ({ db, body, set }) => {
      if (!RULESETS.includes(body.ruleset as (typeof RULESETS)[number])) {
        set.status = 400;
        return { error: "ruleset must be osu, taiko, fruits, or mania" };
      }
      try {
        const result = await previewOnlineScores(db, {
          hubJwt: body.hubJwt,
          ruleset: body.ruleset,
          force: body.force,
        });
        if ("error" in result) {
          set.status = result.code === "account_mismatch" ? 409 : 400;
          return result;
        }
        return result;
      } catch (err) {
        set.status = 502;
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
    {
      body: t.Object({
        hubJwt: t.String({ minLength: 10 }),
        ruleset: t.String(),
        force: t.Optional(t.Boolean()),
      }),
    },
  )
  .post("/commit", async ({ db, set }) => {
    const result = await commitOnlineScores(db);
    if (!result.ok) {
      if (result.code === "locked") set.status = 423;
      else if (result.code === "schema_mismatch" || result.code === "in_flight") set.status = 409;
      else set.status = 500;
      return { error: result.error, code: result.code };
    }
    return result;
  });
