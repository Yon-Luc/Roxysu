/** Open a difficulty in the local osu! client (stable / lazer). */
export function osuClientBeatmapUrl(
  onlineId: number | null | undefined,
): string | null {
  if (onlineId == null || onlineId <= 0) return null;
  return `osu://b/${onlineId}`;
}

/** Open a difficulty on the osu! website. */
export function osuWebBeatmapUrl(
  onlineId: number | null | undefined,
  setOnlineId?: number | null,
): string | null {
  if (onlineId == null || onlineId <= 0) return null;
  if (setOnlineId != null && setOnlineId > 0) {
    return `https://osu.ppy.sh/beatmapsets/${setOnlineId}#osu/${onlineId}`;
  }
  return `https://osu.ppy.sh/b/${onlineId}`;
}

/** Open a user profile on the osu! website. */
export function osuWebUserUrl(
  osuId: number | null | undefined,
): string | null {
  if (osuId == null || !Number.isSafeInteger(osuId) || osuId <= 0) return null;
  return `https://osu.ppy.sh/users/${osuId}`;
}

/**
 * Download a beatmapset `.osz` via Roxysu's mirror redirect (browser download).
 * Prefer `saveMirrorBeatmapset` so archives land in the shared beatmaps folder.
 */
export function mirrorBeatmapSetDownloadUrl(
  setOnlineId: number | null | undefined,
  opts?: { noVideo?: boolean },
): string | null {
  if (setOnlineId == null || setOnlineId <= 0) return null;
  const qs = opts?.noVideo ? "?noVideo=1" : "";
  return `/api/mirrors/beatmapsets/${setOnlineId}/download${qs}`;
}

export type OsuCoverSize = "list" | "card" | "cover" | "slimcover";

/** Beatmapset cover from osu! CDN (null for local/unsubmitted sets). */
export function osuBeatmapCoverUrl(
  setOnlineId: number | null | undefined,
  size: OsuCoverSize = "card",
): string | null {
  if (setOnlineId == null || setOnlineId <= 0) return null;
  // CDN path is `beatmaps/{setId}/covers/…` (not `beatmapsets`).
  return `https://assets.ppy.sh/beatmaps/${setOnlineId}/covers/${size}.jpg`;
}

/** Local background served from lazer's files/ store via Roxysu. */
export function localBeatmapCoverUrl(
  backgroundFileHash: string | null | undefined,
): string | null {
  if (!backgroundFileHash || !/^[0-9a-f]{64}$/i.test(backgroundFileHash)) {
    return null;
  }
  return `/api/covers/${backgroundFileHash.toLowerCase()}`;
}

/** Local audio served from lazer's files/ store via Roxysu. */
export function localBeatmapAudioUrl(
  audioFileHash: string | null | undefined,
): string | null {
  if (!audioFileHash || !/^[0-9a-f]{64}$/i.test(audioFileHash)) {
    return null;
  }
  // `v=2` busts clients that cached pre-Range (non-seekable) responses.
  return `/api/audio/${audioFileHash.toLowerCase()}?v=2`;
}
