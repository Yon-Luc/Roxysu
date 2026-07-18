import { Elysia } from "elysia";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import { getCurrentSession, listSessions } from "../analytics/session";

export const sessionRoutes = new Elysia({ prefix: "/sessions" })
  .use(dbPlugin)
  .get("/", async ({ db }) => {
    const items = await listSessions(db, 100);
    const current = await getCurrentSession(db);
    return {
      current: current
        ? {
            id: current.id,
            startedAt: toIso(current.startedAt),
            endedAt: toIso(current.endedAt),
            scoreCount: current.scoreCount,
            rulesetShortName: current.rulesetShortName,
          }
        : null,
      items: items.map((s) => ({
        id: s.id,
        startedAt: toIso(s.startedAt)!,
        endedAt: toIso(s.endedAt),
        scoreCount: s.scoreCount,
        rulesetShortName: s.rulesetShortName,
      })),
    };
  });
