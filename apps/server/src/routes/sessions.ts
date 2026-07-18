import { Elysia } from "elysia";

/** Session Engine is Phase 5 — return empty list for now. */
export const sessionRoutes = new Elysia({ prefix: "/sessions" }).get(
  "/",
  () => ({
    items: [] as Array<{
      id: number;
      startedAt: string;
      endedAt: string | null;
      scoreCount: number;
      rulesetShortName: string | null;
    }>,
  }),
);
