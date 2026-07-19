import { Elysia } from "elysia";
import { beatmapRoutes } from "./beatmaps";
import { collectionRoutes } from "./collections";
import { coverRoutes } from "./covers";
import { dashboardRoutes } from "./dashboard";
import { practiceRoutes } from "./practice";
import { searchRoutes } from "./search";
import { sessionRoutes } from "./sessions";
import { settingsRoutes } from "./settings";
import { systemRoutes } from "./system";

export const apiRoutes = new Elysia({ prefix: "/api" })
  .use(systemRoutes)
  .use(dashboardRoutes)
  .use(practiceRoutes)
  .use(beatmapRoutes)
  .use(coverRoutes)
  .use(sessionRoutes)
  .use(searchRoutes)
  .use(collectionRoutes)
  .use(settingsRoutes);
