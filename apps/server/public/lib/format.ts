export function formatAccuracy(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function formatPp(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(0)}pp`;
}

export function formatScore(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString();
}

export function formatMisses(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "FC";
  return `${value}x miss`;
}

export function formatStars(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(2)}★`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatMods(mods: string | null | undefined): string {
  if (!mods || mods === "[]" || mods === "{}") return "NM";
  try {
    const parsed = JSON.parse(mods) as unknown;
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return "NM";
      return parsed
        .map((m) => {
          if (typeof m === "string") return m;
          if (m && typeof m === "object" && "acronym" in m) {
            return String((m as { acronym: string }).acronym);
          }
          return String(m);
        })
        .join(",");
    }
  } catch {
    // fall through
  }
  return mods;
}

/** Text for pasting into osu! song select search. */
export function beatmapSearchText(
  title: string | null | undefined,
  difficultyName?: string | null,
): string {
  const sanitize = (s: string) =>
    s
      .replace(/[\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const name = sanitize(title?.trim() || "Untitled") || "Untitled";
  const diff = difficultyName ? sanitize(difficultyName.trim()) : "";
  return diff ? `${name} ${diff}` : name;
}

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
