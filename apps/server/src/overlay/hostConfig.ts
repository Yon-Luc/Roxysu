import { createHash } from "node:crypto";
import { settings } from "@roxysu/db/schema";
import {
  OVERLAY_HOST_ENABLED_KEY,
  OVERLAY_HOST_OUTPUT_KEY,
  OVERLAY_HOST_RESTART_KEY,
  OVERLAY_HOST_URL_KEY,
} from "@roxysu/db/settings-keys";
import type { Db } from "@roxysu/db/types";
import { eq } from "drizzle-orm";

/**
 * Slim In-game overlay host config for the desktop settings poll.
 * Parsing matches the private readers in `routes/settings.ts` — do not
 * invent new boolean, string, or number rules.
 */
export type OverlayHostConfig = {
  enabled: boolean;
  hostUrl: string | null;
  output: string | null;
  restartAt: number | null;
};

async function readOverlayHostUrl(db: Db): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OVERLAY_HOST_URL_KEY))
    .limit(1);
  return row?.value?.trim() ? row.value.trim() : null;
}

async function readOverlayHostOutput(db: Db): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OVERLAY_HOST_OUTPUT_KEY))
    .limit(1);
  return row?.value?.trim() ? row.value.trim() : null;
}

async function readOverlayHostEnabled(db: Db): Promise<boolean> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OVERLAY_HOST_ENABLED_KEY))
    .limit(1);
  return row?.value !== "0";
}

/** Last restart nonce (Unix ms) written by the UI's restart-overlay action. */
async function readOverlayHostRestart(db: Db): Promise<number | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, OVERLAY_HOST_RESTART_KEY))
    .limit(1);
  if (row?.value == null) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

export async function readOverlayHostConfig(
  db: Db,
): Promise<OverlayHostConfig> {
  const [enabled, hostUrl, output, restartAt] = await Promise.all([
    readOverlayHostEnabled(db),
    readOverlayHostUrl(db),
    readOverlayHostOutput(db),
    readOverlayHostRestart(db),
  ]);
  return { enabled, hostUrl, output, restartAt };
}

function stableOverlayHostConfigJson(body: OverlayHostConfig): string {
  return JSON.stringify({
    enabled: body.enabled,
    hostUrl: body.hostUrl,
    output: body.output,
    restartAt: body.restartAt,
  });
}

/** Weak validator over a stable JSON of the four host-config fields. */
export function overlayHostConfigEtag(body: OverlayHostConfig): string {
  const hash = createHash("sha256")
    .update(stableOverlayHostConfigJson(body))
    .digest("hex");
  return `W/"overlay-host-${hash}"`;
}

export function overlayHostConfigNotModified(
  ifNoneMatch: string | null,
  etag: string,
): boolean {
  return ifNoneMatch === etag;
}
