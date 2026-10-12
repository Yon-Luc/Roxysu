import { Elysia } from "elysia";
import { dbPlugin } from "../db-runtime";
import {
  commitScoreTransfer,
  exportScoreTransfer,
  previewScoreTransfer,
} from "../score-transfer/transfer";

export const scoreTransferRoutes = new Elysia({ prefix: "/score-transfer" })
  .use(dbPlugin)
  .get("/export", async ({ db }) => {
    const file = await exportScoreTransfer(db);
    return new Response(JSON.stringify(file), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="roxysu-scores.json"',
      },
    });
  })
  .post("/preview", async ({ db, request, set }) => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      set.status = 400;
      return { error: "Expected a score file" };
    }
    const uploaded = form.get("file");
    if (!(uploaded instanceof Blob)) {
      set.status = 400;
      return { error: "Missing score file" };
    }
    const result = await previewScoreTransfer(db, new Uint8Array(await uploaded.arrayBuffer()));
    if ("error" in result) {
      set.status = 400;
      return result;
    }
    return result;
  })
  .post("/commit", async ({ db, set }) => {
    const result = await commitScoreTransfer(db);
    if (!result.ok) {
      if (result.code === "locked") set.status = 423;
      else if (result.code === "schema_mismatch" || result.code === "in_flight") set.status = 409;
      else set.status = 500;
      return { error: result.error, code: result.code };
    }
    return result;
  });
