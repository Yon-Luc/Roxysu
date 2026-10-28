import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-runtime";
import {
  PARITY_PRESETS,
  parityAccess,
} from "../mania-parity/access";
import {
  PARITY_LIMIT_DEFAULT,
  PARITY_LIMIT_MAX,
  compareManiaParity,
} from "../mania-parity/compare";
import { QueryParseError } from "../query-language";

const CSHARP_HINT =
  "Build the reference runner from packages/mania-difficulty: OSU_GAME_PATH=.cache/upstream dotnet build tools/ReferenceRunner. dotnet must be on PATH.";

export const maniaParityRoutes = new Elysia({ prefix: "/dev/mania-parity" })
  .use(dbPlugin)
  .get("/status", async ({ db, request }) => {
    const access = await parityAccess(db, request.headers.get("authorization") ?? undefined);
    return {
      enabled: access.enabled,
      reason: access.reason,
      sha: access.sha,
      csharpReady: access.csharpReady,
      hint: access.csharpReady ? null : CSHARP_HINT,
      presets: PARITY_PRESETS,
      limitDefault: PARITY_LIMIT_DEFAULT,
      limitMax: PARITY_LIMIT_MAX,
    };
  })
  .post(
    "/compare",
    async ({ db, body, request, set }) => {
      const access = await parityAccess(
        db,
        request.headers.get("authorization") ?? undefined,
      );
      if (!access.enabled) {
        set.status = 404;
        return { error: "Not found" };
      }
      if (!access.csharpReady || !access.csharpDll || !access.sha) {
        set.status = 409;
        return { error: CSHARP_HINT };
      }
      const query = body.query.trim();
      if (!query) {
        set.status = 400;
        return { error: "Query is required" };
      }
      try {
        return await compareManiaParity(db, {
          query,
          limit: body.limit ?? PARITY_LIMIT_DEFAULT,
          sha: access.sha,
          dll: access.csharpDll,
        });
      } catch (err) {
        set.status = 400;
        return {
          error: err instanceof QueryParseError || err instanceof Error
            ? err.message
            : String(err),
        };
      }
    },
    {
      body: t.Object({
        query: t.String(),
        limit: t.Optional(t.Number()),
      }),
    },
  );
