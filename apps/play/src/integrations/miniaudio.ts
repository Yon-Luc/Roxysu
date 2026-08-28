/**
 * Thin wrapper around miniaudio_node — the only module that imports it.
 */
import type { AudioPlayer as MiniaudioPlayer } from "miniaudio_node";

export type NativeAudioPlayer = MiniaudioPlayer;

let modulePromise: Promise<typeof import("miniaudio_node") | null> | undefined;
let cachedModule: typeof import("miniaudio_node") | null | undefined;

export async function loadMiniaudioModule(): Promise<
  typeof import("miniaudio_node") | null
> {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  if (!modulePromise) {
    modulePromise = import("miniaudio_node")
      .then((mod) => {
        cachedModule = mod;
        return mod;
      })
      .catch(() => {
        cachedModule = null;
        return null;
      });
  }
  return modulePromise;
}

export function isNativeAudioAvailable(): boolean {
  return cachedModule != null;
}

export function createNativeAudioPlayer(): NativeAudioPlayer | null {
  if (!cachedModule) return null;
  return new cachedModule.AudioPlayer();
}

/** Eagerly probe native audio so sync factories can choose a backend. */
export function primeNativeAudio(): Promise<boolean> {
  return loadMiniaudioModule().then((mod) => mod != null);
}
