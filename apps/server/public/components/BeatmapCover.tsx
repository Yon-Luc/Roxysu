import { useEffect, useRef, useState } from "react";
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
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const activeSrc = (() => {
    if (sources.length === 0) return null;
    if (!failedSrc) return sources[0]!;
    const idx = sources.indexOf(failedSrc);
    if (idx < 0) return sources[0]!;
    return sources[idx + 1] ?? null;
  })();

  useEffect(() => {
    setLoaded(false);
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [activeSrc]);

  return (
    <div
      aria-hidden={alt ? undefined : true}
      className={`relative overflow-hidden bg-gradient-to-br from-elevated to-canvas ${className}`}
    >
      {activeSrc ? (
        <img
          key={activeSrc}
          ref={imgRef}
          src={activeSrc}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding={priority ? "sync" : "async"}
          // eslint-disable-next-line react/no-unknown-property
          fetchPriority={priority ? "high" : "auto"}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            setFailedSrc(activeSrc);
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
    </div>
  );
}
