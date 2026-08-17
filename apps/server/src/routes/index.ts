import { Elysia } from "elysia";
import { i18nRoutes } from "@roxysu/i18n/server";
import { audioRoutes } from "./audio";
import { beatmapRoutes } from "./beatmaps";
import { collectionRoutes } from "./collections";
import { coverRoutes } from "./covers";
import { dashboardRoutes } from "./dashboard";
import { overlayRoutes } from "./overlay";
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
import { marathonRoutes } from "./marathon";

const productApi = () =>
  new Elysia({ prefix: "/api" })
    .use(i18nRoutes)
    .use(systemRoutes)
    .use(dashboardRoutes)
    .use(overlayRoutes)
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
    .use(marathonRoutes);

/** Desktop / Node product API (no Rating Lab). */
export function createProductApiRoutes() {
  return productApi().use(mirrorRoutes);
}

/** Full Bun API surface including Rating Lab. */
export function createFullApiRoutes() {
  return productApi().use(mirrorRoutes).use(ratingLabRoutes);
}

/** @deprecated Prefer createFullApiRoutes / createProductApiRoutes. */
export function createApiRoutes(options: { includeLab?: boolean } = {}) {
  return options.includeLab === false
    ? createProductApiRoutes()
    : createFullApiRoutes();
}

// Do NOT eagerly `createFullApiRoutes()` here — that pulls Rating Lab into the
// desktop Node cold-eval path even when createApp only mounts product routes.
