import type { AudioEngine } from "./AudioEngine";
import { NativeAudioEngine } from "./NativeAudioEngine";
import { TimelineAudioEngine } from "./TimelineAudioEngine";
import {
  isNativeAudioAvailable,
  primeNativeAudio,
} from "../integrations/miniaudio";

export type AudioBackend = "native" | "timeline";

export function createAudioEngine(backend?: AudioBackend): AudioEngine {
  if (backend === "timeline") {
    return new TimelineAudioEngine();
  }
  if (backend === "native" || isNativeAudioAvailable()) {
    return new NativeAudioEngine();
  }
  return new TimelineAudioEngine();
}

export async function bootstrapAudioEngine(): Promise<{
  engine: AudioEngine;
  backend: AudioBackend;
}> {
  const nativeReady = await primeNativeAudio();
  const engine = createAudioEngine(nativeReady ? "native" : "timeline");
  return {
    engine,
    backend: nativeReady ? "native" : "timeline",
  };
}
