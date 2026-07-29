import { Elysia } from "elysia";
import { audioRoutes } from "./audio";
import { beatmapRoutes } from "./beatmaps";
import { collectionRoutes } from "./collections";
import { coverRoutes } from "./covers";
import { dashboardRoutes } from "./dashboard";
import { practiceRoutes } from "./practice";
import { scoreRoutes } from "./scores";
import { searchRoutes } from "./search";
import { sessionRoutes } from "./sessions";
import { settingsRoutes } from "./settings";
import { statsRoutes } from "./stats";
import { systemRoutes } from "./system";
import { tosuRoutes } from "./tosu";
import { ratingLabRoutes } from "./ratingLab";
import { mirrorRoutes } from "./mirrors";

const productApi = () =>
  new Elysia({ prefix: "/api" })
    .use(systemRoutes)
    .use(dashboardRoutes)
    .use(statsRoutes)
    .use(practiceRoutes)
    .use(beatmapRoutes)
    .use(coverRoutes)
    .use(audioRoutes)
    .use(scoreRoutes)
    .use(sessionRoutes)
    .use(searchRoutes)
    .use(collectionRoutes)
    .use(settingsRoutes)
    .use(tosuRoutes)
    .use(mirrorRoutes);

/** Product API without Rating Lab (desktop / Node). */
export function createProductApiRoutes() {
  return productApi();
}

/** Full Bun API surface including Rating Lab. */
export function createFullApiRoutes() {
  return productApi().use(ratingLabRoutes);
}

/** @deprecated Prefer createFullApiRoutes / createProductApiRoutes. */
export function createApiRoutes(options: { includeLab?: boolean } = {}) {
  return options.includeLab === false
    ? createProductApiRoutes()
    : createFullApiRoutes();
}

export const apiRoutes = createFullApiRoutes();
