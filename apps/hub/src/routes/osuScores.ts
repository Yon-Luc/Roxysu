import Elysia, { status, t } from "elysia";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { budgetHistory, pullRankedBests, readPullProgress } from "../services/osuScores";
import { isScoreRuleset } from "../services/osuScoreShape";

const rulesetQuery = t.Object({
  ruleset: t.String(),
  force: t.Optional(t.String()),
});

function rulesetOr400(raw: string) {
  if (!isScoreRuleset(raw)) {
    return status(400, { message: "ruleset must be osu, taiko, fruits, or mania" });
  }
  return raw;
}

export const osuScoreRoutes = new Elysia({ prefix: "/osu" })
  .use(requireAuth)
  .get(
    "/scores/best",
    async ({ user, query }) => {
      const ruleset = rulesetOr400(query.ruleset);
      if (typeof ruleset !== "string") return ruleset;
      const scores = await pullRankedBests(
        user.osuId,
        ruleset,
        query.force === "1",
      );
      return {
        osuId: user.osuId,
        username: user.username,
        ruleset,
        fromCache: scores.fromCache,
        count: scores.scores.length,
        scores: scores.scores,
        budget: scores.budget,
      };
    },
    { query: rulesetQuery },
  )
  .get(
    "/scores/progress",
    async ({ user, query }) => {
      const ruleset = rulesetOr400(query.ruleset);
      if (typeof ruleset !== "string") return ruleset;
      return readPullProgress(user.osuId, ruleset);
    },
    { query: t.Object({ ruleset: t.String() }) },
  );

export const osuBudgetAdminRoutes = new Elysia({ prefix: "/admin" })
  .use(requireAdmin)
  .get("/osu-budget", async () => budgetHistory(2));
