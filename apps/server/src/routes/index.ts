import { Elysia } from "elysia";
import { i18nRoutes } from "@roxysu/i18n/server";
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
    .use(i18nRoutes)
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
    .use(tosuRoutes);

/** Desktop / Node product API (no Rating Lab, no download mirrors). */
export function createProductApiRoutes() {
  return productApi();
}

/** Full Bun API surface including Rating Lab + download mirrors. */
export function createFullApiRoutes() {
  return productApi().use(mirrorRoutes).use(ratingLabRoutes);
}

/** @deprecated Prefer createFullApiRoutes / createProductApiRoutes. */
export function createApiRoutes(options: { includeLab?: boolean } = {}) {
  return options.includeLab === false
    ? createProductApiRoutes()
    : createFullApiRoutes();
}

// Do NOT eagerly `createFullApiRoutes()` here — that pulls Rating Lab / mirrors
// into the desktop Node cold-eval path even when createApp only mounts product routes.
