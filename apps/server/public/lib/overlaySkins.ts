import {
  getCatchSkin,
  setCatchSkin,
} from "./catchSkin";
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
import {
  exportImportedSpriteDataUrls,
  importImportedSprites,
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
 * consumer pages (OBS / Wayland host) whose own localStorage/IndexedDB start
 * empty; store events re-render whatever is already mounted.
 */
export async function applyOverlaySkinSnapshot(
  snapshot: OverlaySkinSnapshot | null | undefined,
): Promise<void> {
  if (!snapshot) return;
  try {
    if (snapshot.sprites != null) {
      await importImportedSprites(snapshot.sprites);
    }
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
