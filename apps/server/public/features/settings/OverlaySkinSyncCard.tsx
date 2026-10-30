import { useMutation, useQuery } from "@tanstack/react-query";
import {
  countImportedSprites,
} from "../../lib/maniaSkinImport";
import {
  publishOverlaySkins,
} from "../../lib/overlaySkins";
import {
  fetchOverlaySkins,
} from "../../lib/api";
import { useAppDict } from "../../lib/i18n";

/**
 * Shows where the imported .osk sprites actually live (this browser vs the
 * published snapshot) — the #1 confusion behind "overlay shows the default
 * skin". IndexedDB is per browser/app, so the Skin page and the push button
 * must live in the app that owns the sprites.
 */
export function OverlaySkinSyncCard() {
  const { dict } = useAppDict();

  const localQuery = useQuery({
    queryKey: ["overlay", "skin-local-count"],
    queryFn: countImportedSprites,
    staleTime: 5_000,
  });
  const publishedQuery = useQuery({
    queryKey: ["overlay", "skins"],
    queryFn: fetchOverlaySkins,
    staleTime: 5_000,
  });

  const publishMutation = useMutation({ mutationFn: publishOverlaySkins });

  const snapshot = publishedQuery.data?.snapshot ?? null;
  const publishedSprites = Object.keys(snapshot?.sprites ?? {}).length;
  const localSprites = localQuery.data ?? 0;
  const publishedTime = snapshot?.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleTimeString()
    : null;
  const mismatch =
    localSprites > 0 && publishedSprites === 0;

  return (
    <section className="rx-panel space-y-2 p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-faint">
        {dict?.skin.overlaySync?.title ?? "Overlay skin sync"}
      </h3>
      <p className="text-xs text-faint">
        {dict?.skin.overlaySync?.hint ??
          "Overlay consumers (OBS / Wayland host) render with the published snapshot below — push after changing skins."}
      </p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-faint">This browser's imported sprites</dt>
        <dd className="font-semibold tabular-nums">{localSprites}</dd>
        <dt className="text-faint">Published snapshot</dt>
        <dd className="font-semibold tabular-nums">
          {publishedTime
            ? `${publishedSprites} sprite(s) · ${publishedTime}`
            : "nothing published yet"}
        </dd>
      </dl>
      {mismatch ? (
        <p className="text-xs text-danger">
          {dict?.skin.overlaySync?.mismatch ??
            "This browser has sprites that are not published yet — push to update the overlay."}
        </p>
      ) : null}
      <button
        type="button"
        className="rx-btn-primary !px-3 !py-1 text-xs"
        disabled={publishMutation.isPending}
        onClick={() => publishMutation.mutate()}
      >
        {publishMutation.isPending
          ? (dict?.skin.overlaySync?.pushing ?? "Publishing…")
          : (dict?.skin.overlaySync?.push ?? "Push to overlay")}
      </button>
    </section>
  );
}
