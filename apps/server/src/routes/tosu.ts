import { Elysia } from "elysia";
import { dbPlugin } from "../db-runtime";
import {
  ensureTosuStarted,
  getTosuLiveAnalysis,
  getTosuLiveSnapshot,
  requestTosuStart,
} from "../tosu";

export const tosuRoutes = new Elysia({ prefix: "/tosu" })
  .use(dbPlugin)
  .get("/live", async ({ db }) => {
    await ensureTosuStarted(db);
    return getTosuLiveSnapshot();
  })
  .get("/live/analysis", () => getTosuLiveAnalysis())
  .post("/start", async ({ db }) => requestTosuStart(db));
