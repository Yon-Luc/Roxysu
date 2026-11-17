import Elysia, { status, t } from "elysia";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { clientIp } from "../services/clientIp";
import { OsuPullTimeoutError, budgetHistory, pullRankedBests, readPullProgress } from "../services/osuScores";
import { isScoreRuleset } from "../services/osuScoreShape";
import { allowRateLimit } from "../services/rateLimit";

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

function pullUnavailable(err: unknown): string | null {
  if (err instanceof OsuPullTimeoutError) return err.message;
  if (!(err instanceof Error)) return null;
  if (err.message === "osu! rate limit" || err.message.includes("page cap")) {
    return err.message;
  }
  return null;
}

export const osuScoreRoutes = new Elysia({ prefix: "/osu" })
  .use(requireAuth)
  .get(
    "/scores/best",
    async ({ user, query, request, server }) => {
      const ruleset = rulesetOr400(query.ruleset);
      if (typeof ruleset !== "string") return ruleset;
      const ip = clientIp(request, server);
      if (
        !allowRateLimit(`osu-best:${user.sub}`, { limit: 2, windowMs: 60_000 }) ||
        !allowRateLimit(`osu-best-ip:${ip}`, { limit: 6, windowMs: 60_000 })
      ) {
        return status(429, { message: "Too many score pulls" });
      }
      try {
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
      } catch (err) {
        const message = pullUnavailable(err);
        if (message) return status(503, { message });
        throw err;
      }
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
