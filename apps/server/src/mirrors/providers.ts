export type BeatmapMirrorProviderId = "nerinyan" | "osu.direct" | "hinai";

export type BeatmapMirrorProvider = {
  id: BeatmapMirrorProviderId;
  label: string;
  /** Build a third-party .osz download URL for a beatmapset. */
  buildDownloadUrl: (setId: number, opts?: { noVideo?: boolean }) => string;
};

export const BEATMAP_MIRROR_PROVIDERS: Record<
  BeatmapMirrorProviderId,
  BeatmapMirrorProvider
> = {
  nerinyan: {
    id: "nerinyan",
    label: "Nerinyan",
    buildDownloadUrl(setId, opts) {
      const url = new URL(`https://api.nerinyan.moe/d/${setId}`);
      if (opts?.noVideo) url.searchParams.set("nv", "1");
      return url.toString();
    },
  },
  "osu.direct": {
    id: "osu.direct",
    label: "osu.direct",
    buildDownloadUrl(setId, opts) {
      // osu.direct: append `n` for no-video archives when requested.
      const suffix = opts?.noVideo ? "n" : "";
      return `https://osu.direct/api/d/${setId}${suffix}`;
    },
  },
  hinai: {
    id: "hinai",
    label: "hinai (Hinamizawa)",
    buildDownloadUrl(setId, opts) {
      // No-auth 7-source fallback mirror; proxy-streams a real .osz.
      // See https://mirror.hinamizawa.ai/docs/beatmap-download
      const url = new URL(`https://mirror.hinamizawa.ai/api/v1/hinai/d/${setId}`);
      if (opts?.noVideo) url.searchParams.set("noVideo", "1");
      return url.toString();
    },
  },
};

export const DEFAULT_BEATMAP_MIRROR_PROVIDER: BeatmapMirrorProviderId =
  "hinai";

export function isBeatmapMirrorProviderId(
  value: string,
): value is BeatmapMirrorProviderId {
  return value in BEATMAP_MIRROR_PROVIDERS;
}

/** Active mirror from BEATMAP_MIRROR_PROVIDER, falling back to Nerinyan. */
export function getActiveBeatmapMirrorProvider(): BeatmapMirrorProvider {
  const raw = process.env.BEATMAP_MIRROR_PROVIDER?.trim().toLowerCase();
  if (raw && isBeatmapMirrorProviderId(raw)) {
    return BEATMAP_MIRROR_PROVIDERS[raw];
  }
  return BEATMAP_MIRROR_PROVIDERS[DEFAULT_BEATMAP_MIRROR_PROVIDER];
}

export function parsePositiveSetId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}
