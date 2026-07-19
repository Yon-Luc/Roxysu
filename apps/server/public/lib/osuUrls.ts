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

export type OsuCoverSize = "list" | "card" | "cover" | "slimcover";

/** Beatmapset cover from osu! CDN (null for local/unsubmitted sets). */
export function osuBeatmapCoverUrl(
  setOnlineId: number | null | undefined,
  size: OsuCoverSize = "card",
): string | null {
  if (setOnlineId == null || setOnlineId <= 0) return null;
  return `https://assets.ppy.sh/beatmapsets/${setOnlineId}/covers/${size}.jpg`;
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
  return `/api/audio/${audioFileHash.toLowerCase()}`;
}
