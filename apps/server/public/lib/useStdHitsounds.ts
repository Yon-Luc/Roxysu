import { useEffect } from "react";
import type { StdHitObject, StdSampleTiming } from "@roxysu/osu-chart";
import {
  buildStdHitsoundEvents,
  importedLayeredHitSounds,
  resetStdHitsoundCursor,
  setStdHitsoundEvents,
  setStdHitsoundGain,
  setStdHitsoundMuted,
  tickStdHitsounds,
} from "./stdHitsoundPlayer";
import { useImportedStdSprites } from "./stdSkinImport";
import { useStdSkin } from "./stdSkin";

/**
 * Wire imported-skin hitsounds to preview/rewatch. Rebuilds the event list
 * when the chart or imported skin changes; call `onSeek` / `onTick` from the
 * host clock.
 */
export function useStdHitsounds(opts: {
  enabled: boolean;
  hitObjects: StdHitObject[] | null | undefined;
  sampleTiming: StdSampleTiming[] | null | undefined;
  volume: number;
  muted?: boolean;
}): {
  onSeek: (tMs: number) => void;
  onTick: (tMs: number, playing: boolean) => void;
} {
  const skin = useStdSkin();
  // Re-subscribe when sprites/hitsound buffers hydrate after import.
  useImportedStdSprites();

  useEffect(() => {
    setStdHitsoundGain(opts.volume);
    setStdHitsoundMuted(Boolean(opts.muted) || opts.volume <= 0.001);
  }, [opts.volume, opts.muted]);

  useEffect(() => {
    if (!opts.enabled || !opts.hitObjects?.length) {
      setStdHitsoundEvents([]);
      return;
    }
    const layered =
      skin.imported != null ? importedLayeredHitSounds() : true;
    setStdHitsoundEvents(
      buildStdHitsoundEvents(
        opts.hitObjects,
        opts.sampleTiming ?? [],
        layered,
      ),
    );
  }, [
    opts.enabled,
    opts.hitObjects,
    opts.sampleTiming,
    skin.imported?.name,
    skin.imported?.layeredHitSounds,
  ]);

  return {
    onSeek: (tMs: number) => {
      resetStdHitsoundCursor(tMs);
    },
    onTick: (tMs: number, playing: boolean) => {
      if (!opts.enabled || !playing) return;
      tickStdHitsounds(tMs);
    },
  };
}
