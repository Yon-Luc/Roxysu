import { Elysia, t } from "elysia";
import { dbPlugin } from "../db";
import {
  getActiveFormulaId,
  listFormulas,
  runMasteryEngine,
  setActiveFormulaId,
} from "../analytics/mastery/engine";
import { publish } from "../shared/events";

export const settingsRoutes = new Elysia({ prefix: "/settings" })
  .use(dbPlugin)
  .get("/", async ({ db }) => {
    const formulaId = await getActiveFormulaId(db);
    return {
      mastery: {
        formulaId,
        formulas: listFormulas().map((f) => ({
          id: f.id,
          label: f.label,
          description: f.description,
        })),
      },
    };
  })
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

      const formulaId = await getActiveFormulaId(db);
      return {
        mastery: {
          formulaId,
          formulas: listFormulas().map((f) => ({
            id: f.id,
            label: f.label,
            description: f.description,
          })),
        },
      };
    },
    {
      body: t.Object({
        masteryFormulaId: t.Optional(t.String()),
      }),
    },
  );
