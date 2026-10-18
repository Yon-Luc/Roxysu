import type {
  StdHitObject,
  StdHitSample,
  StdSampleTiming,
} from "@roxysu/osu-chart";
import { getStdSkin } from "./stdSkin";
import {
  getImportedStdHitsoundBuffers,
  hitsoundSampleKey,
} from "./stdSkinImport";

const HITSOUND_WHISTLE = 1 << 1;
const HITSOUND_FINISH = 1 << 2;
const HITSOUND_CLAP = 1 << 3;

const SET_NAME: Record<number, string> = {
  1: "normal",
  2: "soft",
  3: "drum",
};

export type StdHitsoundVoice = {
  /** Sample key without prefix, e.g. `soft-hitnormal`. */
  sample: string;
  volume: number;
};

export type StdHitsoundEvent = {
  tMs: number;
  voices: StdHitsoundVoice[];
};

function timingAt(
  timing: StdSampleTiming[],
  tMs: number,
): StdSampleTiming {
  let cur: StdSampleTiming = {
    timeMs: 0,
    sampleSet: 1,
    sampleIndex: 0,
    volume: 100,
  };
  for (const p of timing) {
    if (p.timeMs > tMs) break;
    cur = {
      timeMs: p.timeMs,
      sampleSet: p.sampleSet >= 1 && p.sampleSet <= 3 ? p.sampleSet : cur.sampleSet,
      sampleIndex: p.sampleIndex,
      volume: p.volume,
    };
  }
  return cur;
}

function setName(id: number, fallback: number): string {
  return SET_NAME[id] ?? SET_NAME[fallback] ?? "normal";
}

function resolveSampleContext(
  tMs: number,
  timing: StdSampleTiming[],
  hitSample: StdHitSample | undefined,
): { normalSet: string; additionSet: string; index: number; volume: number } {
  const tp = timingAt(timing, tMs);
  const normalId =
    hitSample && hitSample.normalSet > 0 ? hitSample.normalSet : tp.sampleSet;
  const additionId =
    hitSample && hitSample.additionSet > 0
      ? hitSample.additionSet
      : normalId;
  const index =
    hitSample && hitSample.index > 0 ? hitSample.index : tp.sampleIndex;
  const volume =
    hitSample && hitSample.volume > 0 ? hitSample.volume : tp.volume;
  return {
    normalSet: setName(normalId, 1),
    additionSet: setName(additionId, normalId || 1),
    index: Math.max(0, index),
    volume: Math.min(100, Math.max(0, volume)),
  };
}

function sampleKey(set: string, hit: string, index: number): string {
  return hitsoundSampleKey(set, hit, index);
}

function voicesForHit(
  hitSound: number,
  ctx: ReturnType<typeof resolveSampleContext>,
  layered: boolean,
): StdHitsoundVoice[] {
  const additions: Array<[number, string]> = [
    [HITSOUND_WHISTLE, "hitwhistle"],
    [HITSOUND_FINISH, "hitfinish"],
    [HITSOUND_CLAP, "hitclap"],
  ];
  const hasAddition = additions.some(([bit]) => (hitSound & bit) !== 0);
  const voices: StdHitsoundVoice[] = [];
  if (layered || !hasAddition) {
    voices.push({
      sample: sampleKey(ctx.normalSet, "hitnormal", ctx.index),
      volume: ctx.volume,
    });
  }
  for (const [bit, hit] of additions) {
    if ((hitSound & bit) === 0) continue;
    voices.push({
      sample: sampleKey(ctx.additionSet, hit, ctx.index),
      volume: ctx.volume,
    });
  }
  return voices;
}

function pushEvent(
  out: StdHitsoundEvent[],
  tMs: number,
  voices: StdHitsoundVoice[],
): void {
  if (voices.length === 0) return;
  out.push({ tMs, voices });
}

/**
 * Build discrete hitsound events for preview/rewatch (circles, slider
 * head/ticks/tail, spinner end). Continuous slide/spin loops are deferred.
 */
export function buildStdHitsoundEvents(
  hitObjects: StdHitObject[],
  sampleTiming: StdSampleTiming[],
  layeredHitSounds = true,
): StdHitsoundEvent[] {
  const out: StdHitsoundEvent[] = [];
  const timing = sampleTiming ?? [];

  for (const obj of hitObjects) {
    if (obj.type === "circle") {
      const ctx = resolveSampleContext(obj.timeMs, timing, obj.hitSample);
      pushEvent(
        out,
        obj.timeMs,
        voicesForHit(obj.hitSound ?? 0, ctx, layeredHitSounds),
      );
      continue;
    }

    if (obj.type === "spinner") {
      const ctx = resolveSampleContext(obj.endMs, timing, obj.hitSample);
      pushEvent(
        out,
        obj.endMs,
        voicesForHit(obj.hitSound ?? 0, ctx, layeredHitSounds),
      );
      continue;
    }

    // Slider: head, ticks, tail.
    const headSound = obj.edgeHitSounds?.[0] ?? obj.hitSound ?? 0;
    const headCtx = resolveSampleContext(obj.timeMs, timing, obj.hitSample);
    pushEvent(out, obj.timeMs, voicesForHit(headSound, headCtx, layeredHitSounds));

    for (const tick of obj.ticks ?? []) {
      const tCtx = resolveSampleContext(tick.tMs, timing, obj.hitSample);
      pushEvent(out, tick.tMs, [
        {
          sample: sampleKey(tCtx.normalSet, "slidertick", tCtx.index),
          volume: tCtx.volume,
        },
      ]);
    }

    const tailSound =
      obj.edgeHitSounds && obj.edgeHitSounds.length > 0
        ? obj.edgeHitSounds[obj.edgeHitSounds.length - 1]!
        : (obj.hitSound ?? 0);
    const tailCtx = resolveSampleContext(obj.endMs, timing, obj.hitSample);
    pushEvent(
      out,
      obj.endMs,
      voicesForHit(tailSound, tailCtx, layeredHitSounds),
    );
  }

  out.sort((a, b) => a.tMs - b.tMs);
  return out;
}

let sharedCtx: AudioContext | null = null;
let lastPlayedMs = -Infinity;
let eventCursor = 0;
let activeEvents: StdHitsoundEvent[] = [];
let muted = false;
let gainScale = 1;

function ensureCtx(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!sharedCtx) {
    try {
      sharedCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return sharedCtx;
}

export function setStdHitsoundMuted(next: boolean): void {
  muted = next;
}

export function setStdHitsoundGain(scale: number): void {
  gainScale = Math.min(1, Math.max(0, scale));
}

export function resetStdHitsoundCursor(tMs = 0): void {
  lastPlayedMs = tMs - 0.5;
  // Binary-ish: find first event with tMs > lastPlayedMs
  let lo = 0;
  let hi = activeEvents.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (activeEvents[mid]!.tMs <= lastPlayedMs) lo = mid + 1;
    else hi = mid;
  }
  eventCursor = lo;
}

export function setStdHitsoundEvents(events: StdHitsoundEvent[]): void {
  activeEvents = events;
  resetStdHitsoundCursor(-Infinity);
}

function playBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  volume: number,
): void {
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = (volume / 100) * gainScale;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch {
    // ignore decode/play races
  }
}

/**
 * Advance hitsound playback to `tMs` (map time). Call each animation frame
 * while preview/rewatch audio is running.
 */
export function tickStdHitsounds(tMs: number): void {
  if (muted || gainScale <= 0) return;
  if (!Number.isFinite(tMs)) return;

  // Seek / scrub backwards.
  if (tMs + 40 < lastPlayedMs) {
    resetStdHitsoundCursor(tMs);
  }

  const buffers = getImportedStdHitsoundBuffers();
  if (!buffers || Object.keys(buffers).length === 0) return;

  const ctx = ensureCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }

  // Don't flood if scrubbing far ahead — only play within a small window.
  const maxCatchUp = 80;
  while (eventCursor < activeEvents.length) {
    const ev = activeEvents[eventCursor]!;
    if (ev.tMs > tMs) break;
    if (ev.tMs >= lastPlayedMs - 0.25 && tMs - ev.tMs <= maxCatchUp) {
      for (const voice of ev.voices) {
        const buf =
          buffers[voice.sample] ??
          // Fall back to index-stripped / normal set.
          buffers[voice.sample.replace(/(\d+)$/, "")] ??
          null;
        if (!buf) continue;
        playBuffer(ctx, buf, voice.volume);
      }
    }
    eventCursor += 1;
  }
  lastPlayedMs = tMs;
}

/** Convenience: layered flag from imported skin meta (default true). */
export function importedLayeredHitSounds(): boolean {
  const skin = getStdSkin();
  if (skin.imported?.layeredHitSounds == null) return true;
  return skin.imported.layeredHitSounds;
}
