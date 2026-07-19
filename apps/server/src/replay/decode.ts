import { decompress } from "@napi-rs/lzma/lzma";
import { OsuBinaryReader } from "./binaryReader";

export type ReplayFrame = {
  /** Map-clock time in milliseconds. */
  tMs: number;
  /** Mania key bitmask (bit i = column i pressed). */
  keys: number;
};

export type DecodedReplay = {
  rulesetId: number;
  version: number;
  beatmapMd5: string;
  playerName: string;
  modsLegacy: number;
  frames: ReplayFrame[];
};

const RULESET_MANIA = 3;

/**
 * Decode a lazer/legacy score blob (.osr-compatible) into mania key frames.
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
  const frames = parseReplayFrames(text, rulesetId);

  return {
    rulesetId,
    version,
    beatmapMd5,
    playerName,
    modsLegacy,
    frames,
  };
}

type LegacyFrame = {
  time: number;
  x: number;
  y: number;
  buttons: number;
};

function parseReplayFrames(text: string, rulesetId: number): ReplayFrame[] {
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

  const frames: ReplayFrame[] = [];
  let currentTime: number | null = null;
  let lastKeys = -1;

  for (const f of legacy) {
    // Never allow backwards time relative to the last kept frame.
    if (currentTime != null && f.time < currentTime) continue;
    currentTime = f.time;

    // Mania: pressed columns are encoded in mouseX (lower bits).
    const keys =
      rulesetId === RULESET_MANIA
        ? Math.max(0, Math.floor(f.x)) & ((1 << 20) - 1)
        : Math.max(0, Math.floor(f.buttons));

    if (keys !== lastKeys || frames.length === 0) {
      frames.push({ tMs: f.time, keys });
      lastKeys = keys;
    }
  }

  return frames;
}

export function isManiaRulesetId(id: number): boolean {
  return id === RULESET_MANIA;
}
