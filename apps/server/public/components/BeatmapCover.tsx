import { useState } from "react";
import {
  localBeatmapCoverUrl,
  osuBeatmapCoverUrl,
  type OsuCoverSize,
} from "../lib/osuUrls";

type BeatmapCoverProps = {
  backgroundFileHash?: string | null;
  setOnlineId?: number | null | undefined;
  size?: OsuCoverSize;
  className?: string;
  alt?: string;
  /** Set to true for above-the-fold hero images to skip lazy-loading. */
  priority?: boolean;
};

function coverSources(
  backgroundFileHash: string | null | undefined,
  setOnlineId: number | null | undefined,
  size: OsuCoverSize,
): string[] {
  const urls: string[] = [];
  const local = localBeatmapCoverUrl(backgroundFileHash);
  if (local) urls.push(local);
  const cdn = osuBeatmapCoverUrl(setOnlineId, size);
  if (cdn) urls.push(cdn);
  return urls;
}

export function BeatmapCover({
  backgroundFileHash,
  setOnlineId,
  size = "card",
  className = "",
  alt = "",
  priority = false,
}: BeatmapCoverProps) {
  const sources = coverSources(backgroundFileHash, setOnlineId, size);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const activeSrc = (() => {
    if (sources.length === 0) return null;
    if (!failedSrc) return sources[0]!;
    const idx = sources.indexOf(failedSrc);
    if (idx < 0) return sources[0]!;
    return sources[idx + 1] ?? null;
  })();

  if (!activeSrc) {
    return (
      <div
        aria-hidden={alt ? undefined : true}
        className={`bg-gradient-to-br from-elevated to-canvas ${className}`}
      />
    );
  }

  return (
    <img
      key={activeSrc}
      src={activeSrc}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      // eslint-disable-next-line react/no-unknown-property
      fetchPriority={priority ? "high" : "auto"}
      onError={() => setFailedSrc(activeSrc)}
      className={`object-cover ${className}`}
    />
  );
}
