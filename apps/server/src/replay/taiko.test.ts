import { describe, expect, test } from "bun:test";
import { parseTaikoChart } from "@roxysu/osu-chart";
import { compress } from "@napi-rs/lzma/lzma";
import { decodeLegacyReplay } from "./decode";
import { simulateTaikoJudgments } from "./taikoJudge";
import { parseScoreMods } from "./mods";

const MINIMAL_TAIKO = `osu file format v14

[General]
Mode: 1

[Metadata]
Title:Test
Artist:A
Creator:C
Version:Oni

[Difficulty]
HPDrainRate:5
CircleSize:5
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,2,0,100,1,0

[HitObjects]
256,192,1000,1,0,0:0:0:0:
256,192,1500,1,2,0:0:0:0:
256,192,2000,1,4,0:0:0:0:
128,96,2500,2,0,L|256:96,1,140
256,192,4000,12,0,4500
`;

describe("parseTaikoChart", () => {
  test("parses don, kat, large, drumroll, swell", () => {
    const chart = parseTaikoChart(MINIMAL_TAIKO);
    expect(chart.status).toBe("OK");
    expect(chart.hitObjects.length).toBe(5);
    expect(chart.hitObjects[0]).toMatchObject({
      type: "hit",
      color: "don",
      large: false,
    });
    expect(chart.hitObjects[1]).toMatchObject({
      type: "hit",
      color: "kat",
      large: false,
    });
    expect(chart.hitObjects[2]).toMatchObject({
      type: "hit",
      color: "don",
      large: true,
    });
    expect(chart.hitObjects[3]!.type).toBe("drumroll");
    expect(chart.hitObjects[4]!.type).toBe("swell");
  });

  test("rejects non-taiko modes", () => {
    const chart = parseTaikoChart(MINIMAL_TAIKO.replace("Mode: 1", "Mode: 0"));
    expect(chart.status).toBe("NotTaiko");
  });
});

function writeString(parts: Buffer[], s: string) {
  if (!s) {
    parts.push(Buffer.from([0x00]));
    return;
  }
  const bytes = Buffer.from(s, "utf8");
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
  parts.push(Buffer.from([0]));
  const mods = Buffer.alloc(4);
  mods.writeInt32LE(0);
  parts.push(mods);
  writeString(parts, "");
  const date = Buffer.alloc(8);
  date.writeBigInt64LE(0n);
  parts.push(date);
  const len = Buffer.alloc(4);
  len.writeInt32LE(compressed.length);
  parts.push(len);
  parts.push(compressed);
  return Buffer.concat(parts);
}

describe("decode taiko frames", () => {
  test("fills taikoFrames from buttons and leaves others empty", async () => {
    const text = "0|256|-500|0,0|0|0|0,10|0|0|1,5|0|0|0,-12345|0|0|0";
    const buf = await buildMinimalOsr({ rulesetId: 1, frameText: text });
    const decoded = await decodeLegacyReplay(buf);
    expect(decoded.rulesetId).toBe(1);
    expect(decoded.frames).toEqual([]);
    expect(decoded.stdFrames).toEqual([]);
    expect(decoded.catchFrames).toEqual([]);
    expect(decoded.taikoFrames.some((f) => f.keys === 1)).toBe(true);
  });
});

describe("simulateTaikoJudgments", () => {
  test("hits a don on time", () => {
    const { judgments, summary } = simulateTaikoJudgments({
      hitObjects: [{ type: "hit", timeMs: 1000, color: "don", large: false }],
      frames: [
        { tMs: 0, keys: 0 },
        { tMs: 1000, keys: 1 },
        { tMs: 1010, keys: 0 },
      ],
      overallDifficulty: 5,
      mods: parseScoreMods("[]"),
    });
    expect(judgments[0]!.result).toBe("great");
    expect(summary.counts.miss).toBe(0);
  });
});
