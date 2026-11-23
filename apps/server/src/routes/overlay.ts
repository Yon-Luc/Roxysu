import { beatmapSets, beatmaps, scores, settings } from "@roxysu/db/schema";
import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import { OVERLAY_SKINS_KEY } from "@roxysu/db/settings-keys";

import { dbPlugin } from "../db-runtime";
import { PROFILE_REF_MAX } from "../requestLimits";
import { toIso } from "../shared/serialize";
import { getCurrentSession, listSessionScores } from "../analytics/session";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "../analytics/scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "../analytics/scoreUsername";
import {
  loadManiaPpCurves,
  resolveScorePp,
  type ManiaPpCurve,
} from "../mania-rating/estimateScorePp";
import {
  readOverlayProfiles,
  sanitizeOverlayProfile,
  writeOverlayProfiles,
} from "../overlay/profiles";

export const DEFAULT_OVERLAY_LIMIT = 8;
export const MAX_OVERLAY_LIMIT = 25;

/** Serialized profile cap (elements + free-form options). */
export const MAX_OVERLAY_PROFILE_BODY = 64 * 1024;
/** Bounds for one published overlay skin snapshot. */
export const MAX_OVERLAY_SKIN_SPRITES = 256;
export const MAX_OVERLAY_SKIN_KEY = 128;
export const MAX_OVERLAY_SPRITE_CHARS = 8_000_000;
export const MAX_OVERLAY_SKIN_BODY = 32 * 1024 * 1024;

/** Overlay element fields are clamped later; the schema only bounds the wire shape. */
const overlayProfileNumber = t.Optional(
  t.Union([t.Number(), t.String({ maxLength: 32 })]),
);

const overlayProfileBodySchema = t.Object({
  id: t.Optional(t.String({ maxLength: 64 })),
  name: t.Optional(t.String({ maxLength: 200 })),
  width: overlayProfileNumber,
  height: overlayProfileNumber,
  bg: t.Optional(t.String({ maxLength: 16 })),
  elements: t.Optional(
    t.Array(
      t.Object({
        instanceId: t.Optional(t.String({ maxLength: 64 })),
        type: t.Optional(t.String({ maxLength: 32 })),
        x: overlayProfileNumber,
        y: overlayProfileNumber,
        scale: overlayProfileNumber,
        options: t.Optional(
          t.Union([
            t.Record(t.String({ maxLength: 128 }), t.Unknown(), {
              maxProperties: 64,
            }),
            t.Null(),
          ]),
        ),
        trigger: t.Optional(
          t.Union([
            t.Object({
              field: t.Optional(t.String({ maxLength: 32 })),
              op: t.Optional(t.String({ maxLength: 16 })),
              value: t.Optional(
                t.Union([t.Boolean(), t.String({ maxLength: 64 })]),
              ),
              action: t.Optional(t.String({ maxLength: 16 })),
            }),
            t.Null(),
          ]),
        ),
      }),
      { maxItems: 32 },
    ),
  ),
});

const overlaySkinsBodySchema = t.Object({
  mania: t.Optional(t.Unknown()),
  std: t.Optional(t.Unknown()),
  taiko: t.Optional(t.Unknown()),
  catch: t.Optional(t.Unknown()),
  sprites: t.Optional(
    t.Record(
      t.String({ maxLength: 512 }),
      t.String({ maxLength: MAX_OVERLAY_SKIN_BODY }),
      // The handler returns 413 for the product-level cap; this only stops
      // absurd maps from reaching it.
      { maxProperties: 1024 },
    ),
  ),
});

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function clampOverlayLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_OVERLAY_LIMIT;
  return Math.min(Math.floor(n), MAX_OVERLAY_LIMIT);
}

type OverlayScoreRow = {
  id: string;
  beatmapId: string | null;
  accuracy: number | null;
  pp: number | null;
  mods: string | null;
  rulesetShortName: string | null;
  playedAt: Date | number | null;
  isPb?: boolean | null;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  setOnlineId: number | null;
  backgroundFileHash: string | null;
};

function serializeOverlayScore(
  s: OverlayScoreRow,
  curves: Map<string, ManiaPpCurve>,
) {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    difficultyName: s.difficultyName,
    accuracy: s.accuracy,
    pp: resolveScorePp({
      pp: s.pp,
      accuracy: s.accuracy ?? 0,
      mods: s.mods,
      rulesetShortName: s.rulesetShortName,
      curve: s.beatmapId ? curves.get(s.beatmapId) : undefined,
    }),
    mods: s.mods,
    playedAt: toIso(s.playedAt),
    isPb: Boolean(s.isPb),
    setOnlineId:
      s.setOnlineId != null && s.setOnlineId > 0 ? s.setOnlineId : null,
    backgroundFileHash: s.backgroundFileHash,
  };
}

async function overlayCurves(
  db: Parameters<typeof loadManiaPpCurves>[0],
  rows: OverlayScoreRow[],
) {
  return loadManiaPpCurves(
    db,
    rows
      .map((score) => score.beatmapId)
      .filter((beatmapId): beatmapId is string => beatmapId != null),
  );
}

async function listRecentOverlayScores(
  db: Parameters<typeof listSessionScores>[0],
  limit: number,
): Promise<OverlayScoreRow[]> {
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const scoreScope = and(
    eq(scores.deletePending, false),
    scoresUsernameCondition(usernames),
    scoresGamemodeCondition(gamemode),
  );

  return db
    .select({
      id: scores.id,
      beatmapId: scores.beatmapId,
      accuracy: scores.accuracy,
      pp: scores.pp,
      mods: scores.mods,
      rulesetShortName: scores.rulesetShortName,
      playedAt: scores.playedAt,
      title: beatmaps.title,
      artist: beatmaps.artist,
      difficultyName: beatmaps.difficultyName,
      setOnlineId: beatmapSets.onlineId,
      backgroundFileHash: beatmaps.backgroundFileHash,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
    .where(scoreScope)
    .orderBy(desc(scores.playedAt))
    .limit(limit);
}

export const overlayRoutes = new Elysia({ prefix: "/overlay" })
  .use(dbPlugin)
  .get(
    "/",
    async ({ db, query }) => {
      const limit = clampOverlayLimit(query.limit);
      const current = await getCurrentSession(db);

      const profileRef = query.profile?.trim() || undefined;
      let profile = null;
      if (profileRef) {
        const profiles = await readOverlayProfiles(db);
        const needle = profileRef.toLowerCase();
        profile =
          profiles.find(
            (p) =>
              p.id.toLowerCase() === needle || p.name.toLowerCase() === needle,
          ) ?? null;
      }

      const base = { profile };

      if (current) {
        const scoreRows = await listSessionScores(db, current.id, { limit });
        const curves = await overlayCurves(db, scoreRows);
        return {
          ...base,
          mode: "live" as const,
          session: {
            id: current.id,
            name: current.name,
            scoreCount: current.scoreCount,
          },
          scores: scoreRows.map((s) => serializeOverlayScore(s, curves)),
        };
      }

      const recent = await listRecentOverlayScores(db, limit);
      if (recent.length === 0) {
        return {
          ...base,
          mode: "empty" as const,
          session: null,
          scores: [],
        };
      }

      const curves = await overlayCurves(db, recent);
      return {
        ...base,
        mode: "recent" as const,
        session: null,
        scores: recent.map((s) => serializeOverlayScore(s, curves)),
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        profile: t.Optional(t.String({ maxLength: PROFILE_REF_MAX })),
      }),
    },
  )
  .get("/profiles", async ({ db }) => ({
    profiles: await readOverlayProfiles(db),
  }))
  .put(
    "/profiles/:id",
    async ({ db, params, body }) => {
      // Free-form element options make a field-level cap impractical; bound
      // the whole serialized profile before it reaches the settings store.
      if (JSON.stringify(body).length > MAX_OVERLAY_PROFILE_BODY) {
        return jsonError(413, "overlay profile is too large");
      }
      const incoming = sanitizeOverlayProfile({ ...body, id: params.id });
      if (!incoming) {
        return jsonError(400, "invalid profile");
      }
      const profiles = await readOverlayProfiles(db);
      const idx = profiles.findIndex((p) => p.id === incoming.id);
      if (idx >= 0) profiles[idx] = incoming;
      else profiles.push(incoming);
      await writeOverlayProfiles(db, profiles);
      return { profile: incoming };
    },
    { body: overlayProfileBodySchema },
  )
  .delete(
    "/profiles/:id",
    async ({ db, params }) => {
      const profiles = (await readOverlayProfiles(db)).filter(
        (p) => p.id !== params.id,
      );
      await writeOverlayProfiles(db, profiles);
      return { ok: true };
    },
  )
  .get("/skins", async ({ db }) => {
    const [row] = await db
      .select()
      .from(settings)
      .where(eq(settings.key, OVERLAY_SKINS_KEY))
      .limit(1);
    if (!row?.value) return { snapshot: null };
    try {
      return { snapshot: JSON.parse(row.value) };
    } catch {
      return { snapshot: null };
    }
  })
  .put(
    "/skins",
    async ({ db, body }) => {
      const raw = body as {
        mania?: unknown;
        std?: unknown;
        taiko?: unknown;
        catch?: unknown;
        sprites?: Record<string, string>;
      };
      const spriteEntries = raw.sprites ? Object.entries(raw.sprites) : [];
      if (spriteEntries.length > MAX_OVERLAY_SKIN_SPRITES) {
        return jsonError(
          413,
          `at most ${MAX_OVERLAY_SKIN_SPRITES} sprites can be published`,
        );
      }
      const sprites: Record<string, string> = {};
      let totalChars = 0;
      for (const [key, value] of spriteEntries) {
        // Imported .osk blobs are stored without a MIME type, so exported
        // data URLs may read "data:application/octet-stream;base64,…" —
        // accept any base64 data URL, not just image/*.
        if (
          typeof value === "string" &&
          value.startsWith("data:") &&
          value.includes(";base64,")
        ) {
          if (value.length > MAX_OVERLAY_SPRITE_CHARS) {
            return jsonError(413, `sprite ${key.slice(0, 64)} is too large`);
          }
          totalChars += value.length;
          if (totalChars > MAX_OVERLAY_SKIN_BODY) {
            return jsonError(413, "overlay skin snapshot is too large");
          }
          sprites[key.slice(0, MAX_OVERLAY_SKIN_KEY)] = value;
        }
      }
      const snapshot = {
        updatedAt: new Date().toISOString(),
        mania: raw.mania ?? null,
        std: raw.std ?? null,
        taiko: raw.taiko ?? null,
        catch: raw.catch ?? null,
        sprites,
      };
      const value = JSON.stringify(snapshot);
      if (value.length > MAX_OVERLAY_SKIN_BODY) {
        return jsonError(413, "overlay skin snapshot is too large");
      }
      await db
        .insert(settings)
        .values({ key: OVERLAY_SKINS_KEY, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
      return { ok: true };
    },
    { body: overlaySkinsBodySchema },
  )
  .delete("/skins", async ({ db }) => {
    await db.delete(settings).where(eq(settings.key, OVERLAY_SKINS_KEY));
    return { ok: true };
  })
  .get(
    "/skins/sprites/:id",
    async ({ db, params }) => {
      const [row] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, OVERLAY_SKINS_KEY))
        .limit(1);
      let entry: string | undefined;
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value) as {
            sprites?: Record<string, string>;
          };
          entry = parsed.sprites?.[params.id];
        } catch {
          return new Response("not found", { status: 404 });
        }
      }
      const match = /^data:([\w./+-]*);base64,(.+)$/i.exec(entry ?? "");
      if (!match) return new Response("not found", { status: 404 });
      const bytes = Buffer.from(match[2]!, "base64");
      return new Response(bytes, {
        headers: {
          "content-type": match[1] || "application/octet-stream",
          "cache-control": "no-store",
        },
      });
    },
    { params: t.Object({ id: t.String() }) },
  );
