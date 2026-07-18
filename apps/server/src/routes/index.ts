import { Elysia } from "elysia";
import { beatmapRoutes } from "./beatmaps";
import { dashboardRoutes } from "./dashboard";
import { practiceRoutes } from "./practice";
import { sessionRoutes } from "./sessions";
import { systemRoutes } from "./system";

export const apiRoutes = new Elysia({ prefix: "/api" })
  .use(systemRoutes)
  .use(dashboardRoutes)
  .use(practiceRoutes)
  .use(beatmapRoutes)
  .use(sessionRoutes);
