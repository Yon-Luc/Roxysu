import Elysia, { status, t } from "elysia";
import { clientIp } from "../services/clientIp";
import { isHubCalcBundlesEnabled } from "../services/hubEnv";
import { allowRateLimit } from "../services/rateLimit";
import {
  getCalcBundleByVersion,
  listCalcBundleEntries,
  serializeBundleMeta,
  serializeEntry,
} from "../services/calcBundles";

export const calcBundleRoutes = new Elysia({ prefix: "/calc-bundles" })
  .get(
    "/:version/meta",
    async ({ params, set }) => {
      if (!isHubCalcBundlesEnabled()) {
        set.headers["Cache-Control"] = "no-store";
        return status(503, { message: "Hub calc bundles disabled" });
      }
      const row = await getCalcBundleByVersion(params.version);
      if (!row) return status(404, { message: "Calc bundle not found" });
      set.headers["Cache-Control"] = "no-store";
      return serializeBundleMeta(row);
    },
    {
      params: t.Object({
        version: t.String({ minLength: 1, maxLength: 32 }),
      }),
    },
  )
  .get(
    "/:version",
    async ({ params, set, request, server }) => {
      const ip = clientIp(request, server);
      if (!allowRateLimit(`calc-bundle:${ip}`, { limit: 10, windowMs: 60_000 })) {
        set.status = 429;
        set.headers["Cache-Control"] = "no-store";
        return { message: "Too many calc bundle requests" };
      }
      if (!isHubCalcBundlesEnabled()) {
        set.headers["Cache-Control"] = "no-store";
        return status(503, { message: "Hub calc bundles disabled" });
      }
      const row = await getCalcBundleByVersion(params.version);
      if (!row) return status(404, { message: "Calc bundle not found" });
      const entries = await listCalcBundleEntries(row.id);
      set.headers["Cache-Control"] = "no-store";
      return {
        ...serializeBundleMeta(row),
        entries: entries.map(serializeEntry),
      };
    },
    {
      params: t.Object({
        version: t.String({ minLength: 1, maxLength: 32 }),
      }),
    },
  );
