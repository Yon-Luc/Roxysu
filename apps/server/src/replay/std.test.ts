import { describe, expect, test } from "bun:test";
import { parseStdChart, circleRadius, approachPreemptMs } from "@roxysu/osu-chart";
import { compress } from "@napi-rs/lzma/lzma";
import { decodeLegacyReplay } from "./decode";
import { simulateStdJudgments } from "./stdJudge";
import { parseScoreMods } from "./mods";

const MINIMAL_STD = `osu file format v14

[General]
StackLeniency: 0.7
Mode: 0

[Metadata]
Title:Test
Artist:A
Creator:C
Version:Easy

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:6
ApproachRate:7
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,500,4,2,0,100,1,0

[HitObjects]
256,192,1000,1,0,0:0:0:0:
128,96,1500,2,0,L|256:96,1,100
256,192,3000,12,0,3500
`;

describe("parseStdChart", () => {
  test("parses circles, sliders, and spinners", () => {
    const chart = parseStdChart(MINIMAL_STD);
    expect(chart.status).toBe("OK");
    expect(chart.circleSize).toBe(4);
    expect(chart.approachRate).toBe(7);
    expect(chart.overallDifficulty).toBe(6);
    expect(chart.hitObjects.length).toBe(3);
    expect(chart.hitObjects[0]!.type).toBe("circle");
    expect(chart.hitObjects[1]!.type).toBe("slider");
    expect(chart.hitObjects[2]!.type).toBe("spinner");
    if (chart.hitObjects[1]!.type === "slider") {
      expect(chart.hitObjects[1]!.path.length).toBeGreaterThan(1);
      expect(chart.hitObjects[1]!.endMs).toBeGreaterThan(1500);
    }
  });

  test("rejects non-std modes", () => {
    const chart = parseStdChart(MINIMAL_STD.replace("Mode: 0", "Mode: 3"));
    expect(chart.status).toBe("NotStd");
  });
});

describe("std helpers", () => {
  test("circle radius and preempt are finite", () => {
    expect(circleRadius(4)).toBeGreaterThan(20);
    expect(approachPreemptMs(7)).toBeLessThan(1200);
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

describe("decode std frames", () => {
  test("keeps x/y/buttons for osu ruleset", async () => {
    const text =
      "0|256|-500|0,0|100|100|0,10|120|110|1,5|130|120|0,-12345|0|0|0";
    const buf = await buildMinimalOsr({ rulesetId: 0, frameText: text });
    const decoded = await decodeLegacyReplay(buf);
    expect(decoded.rulesetId).toBe(0);
    expect(decoded.frames).toEqual([]);
    expect(decoded.stdFrames.length).toBeGreaterThanOrEqual(2);
    expect(decoded.stdFrames.some((f) => f.buttons === 1)).toBe(true);
    expect(decoded.stdFrames.some((f) => f.x === 120)).toBe(true);
  });
});

describe("simulateStdJudgments", () => {
  test("hits a circle on time", () => {
    const { judgments, summary } = simulateStdJudgments({
      hitObjects: [
        {
          type: "circle",
          x: 100,
          y: 100,
          timeMs: 1000,
          stackX: 100,
          stackY: 100,
        },
      ],
      frames: [
        { tMs: 0, x: 100, y: 100, buttons: 0 },
        { tMs: 1000, x: 100, y: 100, buttons: 1 },
        { tMs: 1010, x: 100, y: 100, buttons: 0 },
      ],
      circleSize: 4,
      overallDifficulty: 5,
      mods: parseScoreMods("[]"),
    });
    expect(judgments[0]!.result).not.toBe("miss");
    expect(summary.counts.miss).toBe(0);
  });
});
