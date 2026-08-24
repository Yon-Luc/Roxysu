import {
  getCatchSkin,
  setCatchSkin,
} from "./catchSkin";
import { pushToast } from "./toasts";
import {
  getStdSkin,
  setStdSkin,
} from "./stdSkin";
import {
  getTaikoSkin,
  setTaikoSkin,
} from "./taikoSkin";
import {
  getPreviewSkin,
  setPreviewSkin,
  type PreviewSkin,
} from "./previewSkin";
import { putOverlaySkins } from "./api";
import {
  applyOverlaySpriteEntries,
  exportImportedSpriteDataUrls,
} from "./maniaSkinImport";

/** Server-side skin snapshot consumed by overlay pages (OBS / Wayland host). */
export type OverlaySkinSnapshot = {
  updatedAt?: string;
  mania?: PreviewSkin | null;
  std?: unknown;
  taiko?: unknown;
  catch?: unknown;
  sprites?: Record<string, string>;
};

/** Snapshot every local skin config plus imported .osk sprite data URLs. */
export async function collectOverlaySkinSnapshot(): Promise<OverlaySkinSnapshot> {
  let sprites: Record<string, string> = {};
  try {
    sprites = await exportImportedSpriteDataUrls();
  } catch {
    // IndexedDB unavailable — publish configs only.
  }
  return {
    mania: getPreviewSkin(),
    std: getStdSkin(),
    taiko: getTaikoSkin(),
    catch: getCatchSkin(),
    sprites,
  };
}

/**
 * Apply a server-side snapshot to the local skin stores. Used on overlay
 * consumer pages (OBS / Wayland host): sprites load straight from the server
 * (no browser storage involved), then the configs are applied and store
 * events re-render whatever is already mounted.
 */
export async function applyOverlaySkinSnapshot(
  snapshot: OverlaySkinSnapshot | null | undefined,
): Promise<void> {
  if (!snapshot) return;
  try {
    const spriteKeys = Object.keys(snapshot.sprites ?? {});
    if (spriteKeys.length > 0) await applyOverlaySpriteEntries(spriteKeys);
  } catch {
    // Sprites are best-effort; configs still apply.
  }
  try {
    if (snapshot.mania) setPreviewSkin(snapshot.mania);
    if (snapshot.std) setStdSkin(snapshot.std as never);
    if (snapshot.taiko) setTaikoSkin(snapshot.taiko as never);
    if (snapshot.catch) setCatchSkin(snapshot.catch as never);
  } catch {
    // ignore malformed snapshots
  }
}

/**
 * Snapshot the current browser's skins and publish them for overlay
 * consumers. Must be called on the origin that owns any imported .osk
 * sprites (IndexedDB is origin-scoped). Toasts report the outcome.
 */
export async function publishOverlaySkins(): Promise<void> {
  let snapshot: OverlaySkinSnapshot;
  try {
    snapshot = await collectOverlaySkinSnapshot();
  } catch (error) {
    pushToast({ title: String(error), tone: "error" });
    return;
  }
  const keymodes =
    (snapshot.mania as { keymodes?: Record<string, { imported?: unknown }> })
      ?.keymodes ?? {};
  const hasImported = Object.values(keymodes).some((k) => k?.imported);
  const spriteCount = Object.keys(snapshot.sprites ?? {}).length;
  try {
    await publish(snapshot);
  } catch (error) {
    pushToast({ title: String(error), tone: "error" });
    return;
  }
  if (hasImported && spriteCount === 0) {
    pushToast({
      title: "Published without imported sprites",
      detail:
        "Your mania skin uses an imported .osk, but its sprites were not found in this browser. Skins are stored per origin — open Roxysu on the same address (localhost vs 127.0.0.1) where you imported the skin, then push again.",
      tone: "error",
      durationMs: null,
    });
    return;
  }
  pushToast({
    title: "Overlay skins published",
    detail:
      spriteCount > 0
        ? `${spriteCount} imported sprite(s) included — every overlay consumer will use them.`
        : "Overlay consumers will render with these skins.",
    tone: "success",
  });
}

async function publish(snapshot: OverlaySkinSnapshot): Promise<void> {
  await putOverlaySkins(snapshot);
}
