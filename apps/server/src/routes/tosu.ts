import { Elysia } from "elysia";
import { dbPlugin } from "../db-runtime";
import {
  getTosuLiveSnapshot,
  requestTosuStart,
} from "../tosu";

export const tosuRoutes = new Elysia({ prefix: "/tosu" })
  .use(dbPlugin)
  .get("/live", () => getTosuLiveSnapshot())
  .post("/start", async ({ db }) => requestTosuStart(db));
