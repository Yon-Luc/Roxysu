import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchOverlaySkins } from "../../lib/api";
import { useAppDict } from "../../lib/i18n";
import { useCatchSkin } from "../../lib/catchSkin";
import {
  countLocalOverlaySprites,
  useOverlaySkinSyncState,
} from "../../lib/overlaySkins";
import { usePreviewSkin } from "../../lib/previewSkin";
import { useStdSkin } from "../../lib/stdSkin";

/**
 * Shows whether this browser's skins are the ones overlay consumers render.
 * Publishing is automatic; this card only reports status and the origin
 * mismatch (IndexedDB sprites are per browser, per address).
 */
export function OverlaySkinSyncCard() {
  const { dict } = useAppDict();
  const queryClient = useQueryClient();
  const sync = useOverlaySkinSyncState();
  const mania = usePreviewSkin();
  const std = useStdSkin();
  const fruits = useCatchSkin();

  const localQuery = useQuery({
    queryKey: ["overlay", "skin-local-count"],
    queryFn: countLocalOverlaySprites,
    staleTime: 5_000,
  });
  const publishedQuery = useQuery({
    queryKey: ["overlay", "skins"],
    queryFn: fetchOverlaySkins,
    staleTime: 5_000,
  });

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["overlay", "skin-local-count"] });
    if (sync.phase === "idle") {
      void queryClient.invalidateQueries({ queryKey: ["overlay", "skins"] });
    }
  }, [queryClient, sync.phase]);

  const snapshot = publishedQuery.data?.snapshot ?? null;
  const publishedSprites = Object.keys(snapshot?.sprites ?? {}).length;
  const localSprites = localQuery.data ?? 0;
  const publishedTime = snapshot?.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleTimeString()
    : null;
  const importedConfigured =
    Object.values(mania.keymodes).some((slot) => slot.imported) ||
    Boolean(std.imported) ||
    Boolean(fruits.imported);
  const mismatch =
    sync.phase !== "syncing" && localSprites > 0 && publishedSprites === 0;
  const missingSprites =
    sync.phase !== "syncing" && importedConfigured && localSprites === 0;
  const copy = dict?.skin.overlaySync;

  return (
    <section className="rx-panel space-y-2 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-faint">
        {copy?.title ?? "Overlay skin sync"}
      </h3>
      <p className="text-xs text-faint">
        {copy?.hint ??
          "The overlay follows the skins in this app. OBS and the Wayland host pick up changes on their own."}
      </p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-faint">This browser's imported sprites</dt>
        <dd className="font-semibold tabular-nums">{localSprites}</dd>
        <dt className="text-faint">Overlay</dt>
        <dd className="font-semibold tabular-nums">
          {sync.phase === "syncing"
            ? (copy?.syncing ?? "Syncing…")
            : publishedTime
              ? `${copy?.synced ?? "Synced"} · ${publishedSprites} sprite(s) · ${publishedTime}`
              : (copy?.empty ?? "Nothing synced yet")}
        </dd>
      </dl>
      {mismatch ? (
        <p className="text-xs text-danger">
          {copy?.mismatch ??
            "This browser has sprites that are not on the overlay yet."}
        </p>
      ) : null}
      {missingSprites ? (
        <p className="text-xs text-danger">
          {copy?.missingSprites ??
            "An imported skin is configured, but its sprites are not in this browser. Open Roxysu on the same address (localhost vs 127.0.0.1) where you imported the skin."}
        </p>
      ) : null}
      {sync.phase === "error" ? (
        <p className="text-xs text-danger">
          {copy?.error ?? "Couldn't sync skins to the overlay."}
          {sync.error ? ` ${sync.error}` : ""}
        </p>
      ) : null}
    </section>
  );
}
