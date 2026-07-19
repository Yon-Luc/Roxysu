import { describe, expect, test } from "bun:test";
import { compress } from "@napi-rs/lzma/lzma";
import { decodeLegacyReplay } from "./decode";
import { maniaHitWindows, simulateManiaJudgments } from "./judge";
import { parseScoreMods } from "./mods";

function writeString(parts: Buffer[], s: string) {
  if (!s) {
    parts.push(Buffer.from([0x00]));
    return;
  }
  const bytes = Buffer.from(s, "utf8");
  // marker + uleb128 length (single byte for short strings)
  if (bytes.length >= 0x80) throw new Error("test string too long");
  parts.push(Buffer.from([0x0b, bytes.length]));
  parts.push(bytes);
}

async function buildMinimalOsr(opts: {
  rulesetId: number;
  frameText: string;
}): Promise<Buffer> {
  const compressed = Buffer.from(await compress(Buffer.from(opts.frameText)));
  const parts: Buffer[] = [];
  parts.push(Buffer.from([opts.rulesetId]));
  const version = Buffer.alloc(4);
  version.writeInt32LE(20240101);
  parts.push(version);
  writeString(parts, "beatmapmd5");
  writeString(parts, "player");
  writeString(parts, "replaymd5");
  for (let i = 0; i < 6; i += 1) {
    const u = Buffer.alloc(2);
    u.writeUInt16LE(0);
    parts.push(u);
  }
  const score = Buffer.alloc(4);
  score.writeInt32LE(0);
  parts.push(score);
  const combo = Buffer.alloc(2);
  combo.writeUInt16LE(0);
  parts.push(combo);
  parts.push(Buffer.from([0])); // perfect
  const mods = Buffer.alloc(4);
  mods.writeInt32LE(0);
  parts.push(mods);
  writeString(parts, ""); // life
  const date = Buffer.alloc(8);
  date.writeBigInt64LE(0n);
  parts.push(date);
  const len = Buffer.alloc(4);
  len.writeInt32LE(compressed.length);
  parts.push(len);
  parts.push(compressed);
  return Buffer.concat(parts);
}

describe("decodeLegacyReplay", () => {
  test("parses mania key frames and drops dummy lead-in", async () => {
    // dummy, dummy, then real key presses
    const text =
      "0|256|-500|0,0|256|-500|0,0|0|0|0,10|1|0|0,5|3|0|0,-12345|0|0|0";
    const buf = await buildMinimalOsr({ rulesetId: 3, frameText: text });
    const decoded = await decodeLegacyReplay(buf);
    expect(decoded.rulesetId).toBe(3);
    expect(decoded.frames.length).toBeGreaterThanOrEqual(2);
    expect(decoded.frames[0]!.keys).toBe(0);
    expect(decoded.frames.some((f) => f.keys === 1)).toBe(true);
    expect(decoded.frames.some((f) => f.keys === 3)).toBe(true);
  });

  test("applies negative deltas then drops backwards frames", async () => {
    // Lead-in rewind: -100 then +50 +50 → press lands at t=0.
    // Skipping negatives used to leave the clock permanently shifted.
    const text = "-100|0|0|0,50|0|0|0,50|1|0|0,-12345|0|0|0";
    const buf = await buildMinimalOsr({ rulesetId: 3, frameText: text });
    const decoded = await decodeLegacyReplay(buf);
    expect(decoded.frames[0]!.tMs).toBe(-100);
    const press = decoded.frames.find((f) => f.keys === 1);
    expect(press?.tMs).toBe(0);
  });
});

describe("simulateManiaJudgments", () => {
  test("hits a note on time as perfect", () => {
    const { judgments, summary } = simulateManiaJudgments({
      notes: [{ column: 0, startMs: 1000, endMs: 1000 }],
      frames: [
        { tMs: 0, keys: 0 },
        { tMs: 1000, keys: 1 },
        { tMs: 1010, keys: 0 },
      ],
      columnCount: 4,
      overallDifficulty: 8,
      mods: parseScoreMods("[]"),
    });
    expect(judgments[0]!.result).toBe("perfect");
    expect(summary.counts.perfect).toBe(1);
    expect(summary.maxCombo).toBe(1);
  });

  test("misses when never pressed", () => {
    const { summary } = simulateManiaJudgments({
      notes: [{ column: 0, startMs: 1000, endMs: 1000 }],
      frames: [{ tMs: 0, keys: 0 }, { tMs: 5000, keys: 0 }],
      columnCount: 4,
      overallDifficulty: 8,
      mods: parseScoreMods("[]"),
    });
    expect(summary.counts.miss).toBe(1);
  });
});

describe("maniaHitWindows", () => {
  test("OD8 great window", () => {
    const w = maniaHitWindows(8);
    expect(w.perfect).toBe(16);
    expect(w.great).toBe(40);
  });
});
