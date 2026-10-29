import { useSyncExternalStore } from "react";
import { getCatchSkin, setCatchSkin, subscribeCatchSkin } from "./catchSkin";
import { getStdSkin, setStdSkin, subscribeStdSkin } from "./stdSkin";
import { getTaikoSkin, setTaikoSkin, subscribeTaikoSkin } from "./taikoSkin";
import {
  getPreviewSkin,
  setPreviewSkin,
  subscribePreviewSkin,
  type PreviewSkin,
} from "./previewSkin";
import { putOverlaySkins } from "./api";
import {
  applyOverlaySpriteEntries,
  countImportedSprites,
  exportImportedSpriteDataUrls,
  subscribeImportedManiaSprites,
} from "./maniaSkinImport";
import {
  applyOverlayStdSpriteEntries,
  countImportedStdSprites,
  exportImportedStdSpriteDataUrls,
  subscribeImportedStdSprites,
} from "./stdSkinImport";
import {
  applyOverlayCatchSpriteDataUrls,
  countImportedCatchSprites,
  exportImportedCatchSpriteDataUrls,
  subscribeImportedCatchSprites,
} from "./catchSkinImport";

/** Server-side skin snapshot consumed by overlay pages (OBS / Wayland host). */
export type OverlaySkinSnapshot = {
  updatedAt?: string;
  spritesUpdatedAt?: string | null;
  mania?: PreviewSkin | null;
  std?: unknown;
  taiko?: unknown;
  catch?: unknown;
  sprites?: Record<string, string>;
};

export type OverlaySkinSyncPhase = "idle" | "syncing" | "error";

export type OverlaySkinSyncState = {
  phase: OverlaySkinSyncPhase;
  error: string | null;
};

const SKIN_SYNC_DEBOUNCE_MS = 700;

const idleSync: OverlaySkinSyncState = { phase: "idle", error: null };
let syncState: OverlaySkinSyncState = idleSync;
const syncListeners = new Set<() => void>();

function setSyncState(next: OverlaySkinSyncState): void {
  if (syncState.phase === next.phase && syncState.error === next.error) return;
  syncState = next;
  for (const listener of syncListeners) listener();
}

export function useOverlaySkinSyncState(): OverlaySkinSyncState {
  return useSyncExternalStore(
    (onStoreChange) => {
      syncListeners.add(onStoreChange);
      return () => {
        syncListeners.delete(onStoreChange);
      };
    },
    () => syncState,
    () => idleSync,
  );
}

/** How many imported .osk sprites this browser can publish. */
export async function countLocalOverlaySprites(): Promise<number> {
  const [mania, std, fruits] = await Promise.all([
    countImportedSprites(),
    countImportedStdSprites(),
    countImportedCatchSprites(),
  ]);
  return mania + std + fruits;
}

function snapshotHasImportedConfig(snapshot: OverlaySkinSnapshot): boolean {
  const keymodes =
    (snapshot.mania as { keymodes?: Record<string, { imported?: unknown }> } | null)
      ?.keymodes ?? {};
  const mania = Object.values(keymodes).some((slot) => slot?.imported);
  const std = Boolean(
    (snapshot.std as { imported?: unknown } | null | undefined)?.imported,
  );
  const fruits = Boolean(
    (snapshot.catch as { imported?: unknown } | null | undefined)?.imported,
  );
  return mania || std || fruits;
}

function spriteEventIsHydrate(event: Event): boolean {
  const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
  return reason === "hydrate";
}

/** Snapshot every local skin config plus imported .osk sprite data URLs. */
export async function collectOverlaySkinSnapshot(): Promise<OverlaySkinSnapshot> {
  let sprites: Record<string, string> = {};
  try {
    const [mania, std, catchSprites] = await Promise.all([
      exportImportedSpriteDataUrls(),
      exportImportedStdSpriteDataUrls(),
      exportImportedCatchSpriteDataUrls(),
    ]);
    sprites = { ...mania, ...std, ...catchSprites };
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
  options?: { sprites?: boolean },
): Promise<void> {
  if (!snapshot) return;
  if (options?.sprites !== false) {
    try {
      const spriteKeys = Object.keys(snapshot.sprites ?? {});
      if (spriteKeys.length > 0) {
        await Promise.all([
          applyOverlaySpriteEntries(spriteKeys),
          applyOverlayStdSpriteEntries(spriteKeys),
        ]);
      }
      if (snapshot.sprites) {
        await applyOverlayCatchSpriteDataUrls(snapshot.sprites);
      }
    } catch {
      // Sprites are best-effort; configs still apply.
    }
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
 * Publish this browser's skins for overlay consumers.
 * Config-only publishes omit `sprites` so the server keeps the stored map.
 * An imported skin with no local sprites is skipped — publishing that would
 * strip sprites that live on another origin.
 */
export async function publishOverlaySkins(options: {
  includeSprites: boolean;
}): Promise<"published" | "skipped"> {
  const snapshot = await collectOverlaySkinSnapshot();
  const spriteCount = Object.keys(snapshot.sprites ?? {}).length;
  if (snapshotHasImportedConfig(snapshot) && spriteCount === 0) {
    return "skipped";
  }
  if (options.includeSprites) {
    await putOverlaySkins(snapshot);
  } else {
    const { sprites: _sprites, ...configs } = snapshot;
    await putOverlaySkins(configs);
  }
  return "published";
}

/**
 * Publish skin edits from the main app. Mounted from AppShell so the overlay
 * route, which applies snapshots into the same stores, never publishes back.
 */
export function startOverlaySkinAutoSync(options?: {
  onPublished?: () => void;
}): () => void {
  let disposed = false;
  let startupDone = false;
  let includeSprites = false;
  let userEdited = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushGen = 0;

  function arm(delayMs: number) {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delayMs);
  }

  function schedule(fromSprites: boolean) {
    if (disposed) return;
    if (fromSprites) includeSprites = true;
    userEdited = true;
    pending = true;
    setSyncState({ phase: "syncing", error: null });
    if (!startupDone) return;
    arm(SKIN_SYNC_DEBOUNCE_MS);
  }

  function onSprites(event: Event) {
    if (spriteEventIsHydrate(event)) return;
    schedule(true);
  }

  const unsubs = [
    subscribePreviewSkin(() => schedule(false)),
    subscribeStdSkin(() => schedule(false)),
    subscribeTaikoSkin(() => schedule(false)),
    subscribeCatchSkin(() => schedule(false)),
    subscribeImportedManiaSprites(onSprites),
    subscribeImportedStdSprites(onSprites),
    subscribeImportedCatchSprites(onSprites),
  ];

  async function flush() {
    if (disposed) return;
    const sendSprites = includeSprites;
    includeSprites = false;
    pending = false;
    const gen = ++flushGen;
    setSyncState({ phase: "syncing", error: null });
    try {
      const result = await publishOverlaySkins({ includeSprites: sendSprites });
      if (disposed || gen !== flushGen || pending) return;
      setSyncState(idleSync);
      if (result === "published") options?.onPublished?.();
    } catch (error) {
      if (disposed || gen !== flushGen || pending) return;
      setSyncState({
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  void (async () => {
    let count = 0;
    try {
      count = await countLocalOverlaySprites();
    } catch {
      count = 0;
    }
    if (disposed) return;
    startupDone = true;
    if (count > 0) includeSprites = true;
    if (count > 0 || userEdited) {
      setSyncState({ phase: "syncing", error: null });
      arm(userEdited ? SKIN_SYNC_DEBOUNCE_MS : 0);
    }
  })();

  return () => {
    disposed = true;
    if (timer != null) clearTimeout(timer);
    for (const unsub of unsubs) unsub();
  };
}
