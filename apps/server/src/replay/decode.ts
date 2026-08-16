import { decompress } from "@napi-rs/lzma/lzma";
import { OsuBinaryReader } from "./binaryReader";

/** Mania key bitmask frame. */
export type ManiaReplayFrame = {
  tMs: number;
  keys: number;
};

/** Standard cursor/button frame (osu! coords). */
export type StdReplayFrame = {
  tMs: number;
  x: number;
  y: number;
  buttons: number;
};

/** Taiko drum bitmask: 1 left don, 2 left kat, 4 right don, 8 right kat. */
export type TaikoReplayFrame = {
  tMs: number;
  keys: number;
};

/** Catcher position + dash. */
export type CatchReplayFrame = {
  tMs: number;
  x: number;
  dashing: boolean;
};

export const TAIKO_LEFT_DON = 1;
export const TAIKO_LEFT_KAT = 2;
export const TAIKO_RIGHT_DON = 4;
export const TAIKO_RIGHT_KAT = 8;

/** @deprecated Prefer ManiaReplayFrame — kept for mania-judge compatibility. */
export type ReplayFrame = ManiaReplayFrame;

export type DecodedReplay = {
  rulesetId: number;
  version: number;
  beatmapMd5: string;
  playerName: string;
  modsLegacy: number;
  /** Mania key frames when ruleset is mania; empty otherwise. */
  frames: ManiaReplayFrame[];
  /** Standard cursor frames when ruleset is osu; empty otherwise. */
  stdFrames: StdReplayFrame[];
  /** Taiko drum frames when ruleset is taiko; empty otherwise. */
  taikoFrames: TaikoReplayFrame[];
  /** Catcher frames when ruleset is fruits; empty otherwise. */
  catchFrames: CatchReplayFrame[];
};

const RULESET_OSU = 0;
const RULESET_TAIKO = 1;
const RULESET_FRUITS = 2;
const RULESET_MANIA = 3;

/**
 * Decode a lazer/legacy score blob (.osr-compatible).
 * Timing follows LegacyScoreDecoder: apply all deltas (including negative),
 * then drop frames that would rewind time.
 */
export async function decodeLegacyReplay(
  data: Buffer | Uint8Array,
): Promise<DecodedReplay> {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const r = new OsuBinaryReader(buf);

  const rulesetId = r.readByte();
  const version = r.readInt32();
  const beatmapMd5 = r.readString();
  const playerName = r.readString();
  r.readString(); // replay md5
  r.readUInt16(); // count300
  r.readUInt16(); // count100
  r.readUInt16(); // count50
  r.readUInt16(); // countGeki
  r.readUInt16(); // countKatu
  r.readUInt16(); // countMiss
  r.readInt32(); // totalScore
  r.readUInt16(); // maxCombo
  r.readByte(); // perfect
  const modsLegacy = r.readInt32();
  r.readString(); // life graph
  r.readDate(); // timestamp
  const compressedLen = r.readInt32();
  if (compressedLen < 0 || compressedLen > r.remaining) {
    throw new Error("Invalid compressed replay length");
  }
  const compressed = r.readBytes(compressedLen);
  // Online ID + optional trailing ScoreInfo payload — ignored for playback.

  const decompressed = await decompress(compressed);
  const text = Buffer.from(decompressed).toString("ascii");
  const legacy = parseLegacyFrames(text);

  const frames =
    rulesetId === RULESET_MANIA ? toManiaFrames(legacy) : [];
  const stdFrames =
    rulesetId === RULESET_OSU ? toStdFrames(legacy) : [];
  const taikoFrames =
    rulesetId === RULESET_TAIKO ? toTaikoFrames(legacy) : [];
  const catchFrames =
    rulesetId === RULESET_FRUITS ? toCatchFrames(legacy) : [];

  return {
    rulesetId,
    version,
    beatmapMd5,
    playerName,
    modsLegacy,
    frames,
    stdFrames,
    taikoFrames,
    catchFrames,
  };
}

type LegacyFrame = {
  time: number;
  x: number;
  y: number;
  buttons: number;
};

function parseLegacyFrames(text: string): LegacyFrame[] {
  const parts = text.split(",");
  const legacy: LegacyFrame[] = [];
  let lastTime = 0;

  for (const part of parts) {
    if (!part) continue;
    const split = part.split("|");
    if (split.length < 4) continue;

    // Seed / end marker used by lazer + stable.
    if (split[0] === "-12345") continue;

    let diff: number;
    if (/^-?\d+$/.test(split[0]!)) {
      diff = Number(split[0]);
    } else {
      const f = Number(split[0]);
      if (!Number.isFinite(f)) continue;
      diff = Math.round(f);
    }

    const x = Number(split[1]);
    const y = Number(split[2]);
    const buttons = Number(split[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(buttons)) {
      continue;
    }

    // Apply every delta — including negative. Skipping negatives (old bug)
    // permanently shifts the replay clock and destroys mania hit matching.
    lastTime += diff;
    legacy.push({ time: lastTime, x, y, buttons });
  }

  // Stable ReplayWatcher lead-in quirks (ported from LegacyScoreDecoder).
  if (legacy.length >= 2 && legacy[1]!.time < legacy[0]!.time) {
    legacy[1]!.time = legacy[0]!.time;
    legacy[0]!.time = 0;
  }
  if (legacy.length >= 3 && legacy[0]!.time > legacy[2]!.time) {
    legacy[0]!.time = legacy[1]!.time = legacy[2]!.time;
  }

  // Dummy frames at (256, -500) — must remove before mania key decode.
  if (
    legacy.length >= 2 &&
    legacy[1]!.x === 256 &&
    legacy[1]!.y === -500
  ) {
    legacy.splice(1, 1);
  }
  if (legacy.length >= 1 && legacy[0]!.x === 256 && legacy[0]!.y === -500) {
    legacy.splice(0, 1);
  }

  return legacy;
}

function toManiaFrames(legacy: LegacyFrame[]): ManiaReplayFrame[] {
  const frames: ManiaReplayFrame[] = [];
  let currentTime: number | null = null;
  let lastKeys = -1;

  for (const f of legacy) {
    if (currentTime != null && f.time < currentTime) continue;
    currentTime = f.time;

    const keys = Math.max(0, Math.floor(f.x)) & ((1 << 20) - 1);

    if (keys !== lastKeys || frames.length === 0) {
      frames.push({ tMs: f.time, keys });
      lastKeys = keys;
    }
  }

  return frames;
}

function toStdFrames(legacy: LegacyFrame[]): StdReplayFrame[] {
  const frames: StdReplayFrame[] = [];
  let currentTime: number | null = null;
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let lastButtons = -1;

  for (const f of legacy) {
    if (currentTime != null && f.time < currentTime) continue;
    currentTime = f.time;

    // Drop near-duplicates to keep payloads smaller.
    if (
      frames.length > 0 &&
      f.buttons === lastButtons &&
      Math.abs(f.x - lastX) < 0.01 &&
      Math.abs(f.y - lastY) < 0.01
    ) {
      continue;
    }

    frames.push({
      tMs: f.time,
      x: f.x,
      y: f.y,
      buttons: Math.max(0, Math.floor(f.buttons)),
    });
    lastX = f.x;
    lastY = f.y;
    lastButtons = f.buttons;
  }

  return frames;
}

function toTaikoFrames(legacy: LegacyFrame[]): TaikoReplayFrame[] {
  const frames: TaikoReplayFrame[] = [];
  let currentTime: number | null = null;
  let lastKeys = -1;

  for (const f of legacy) {
    if (currentTime != null && f.time < currentTime) continue;
    currentTime = f.time;
    const keys = Math.max(0, Math.floor(f.buttons)) & 15;
    if (keys !== lastKeys || frames.length === 0) {
      frames.push({ tMs: f.time, keys });
      lastKeys = keys;
    }
  }

  return frames;
}

function toCatchFrames(legacy: LegacyFrame[]): CatchReplayFrame[] {
  const frames: CatchReplayFrame[] = [];
  let currentTime: number | null = null;
  let lastX = Number.NaN;
  let lastDash = false;

  for (const f of legacy) {
    if (currentTime != null && f.time < currentTime) continue;
    currentTime = f.time;
    const dashing = (Math.floor(f.buttons) & 1) !== 0;
    if (
      frames.length > 0 &&
      dashing === lastDash &&
      Math.abs(f.x - lastX) < 0.01
    ) {
      continue;
    }
    frames.push({ tMs: f.time, x: f.x, dashing });
    lastX = f.x;
    lastDash = dashing;
  }

  return frames;
}

export function isManiaRulesetId(id: number): boolean {
  return id === RULESET_MANIA;
}

export function isOsuRulesetId(id: number): boolean {
  return id === RULESET_OSU;
}

export function isTaikoRulesetId(id: number): boolean {
  return id === RULESET_TAIKO;
}

export function isFruitsRulesetId(id: number): boolean {
  return id === RULESET_FRUITS;
}
