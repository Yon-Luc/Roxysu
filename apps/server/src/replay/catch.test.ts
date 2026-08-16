import { describe, expect, test } from "bun:test";
import { parseCatchChart } from "@roxysu/osu-chart";
import { compress } from "@napi-rs/lzma/lzma";
import { decodeLegacyReplay } from "./decode";
import { simulateCatchJudgments } from "./catchJudge";
import { parseScoreMods } from "./mods";

const MINIMAL_CATCH = `osu file format v14

[General]
Mode: 2

[Metadata]
Title:Test
Artist:A
Creator:C
Version:Rain

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
128,96,1500,2,0,L|256:96,1,140
256,192,3000,12,0,3500
`;

describe("parseCatchChart", () => {
  test("parses fruits, juice stream, banana shower", () => {
    const chart = parseCatchChart(MINIMAL_CATCH);
    expect(chart.status).toBe("OK");
    expect(chart.circleSize).toBe(4);
    expect(chart.hitObjects.some((o) => o.type === "fruit")).toBe(true);
    expect(chart.hitObjects.some((o) => o.type === "droplet")).toBe(true);
    expect(chart.hitObjects.some((o) => o.type === "banana")).toBe(true);
  });

  test("rejects non-catch modes", () => {
    const chart = parseCatchChart(MINIMAL_CATCH.replace("Mode: 2", "Mode: 0"));
    expect(chart.status).toBe("NotCatch");
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

describe("decode catch frames", () => {
  test("fills catchFrames from x/buttons and leaves others empty", async () => {
    const text = "0|256|-500|0,0|200|0|0,10|220|0|1,5|240|0|0,-12345|0|0|0";
    const buf = await buildMinimalOsr({ rulesetId: 2, frameText: text });
    const decoded = await decodeLegacyReplay(buf);
    expect(decoded.rulesetId).toBe(2);
    expect(decoded.frames).toEqual([]);
    expect(decoded.stdFrames).toEqual([]);
    expect(decoded.taikoFrames).toEqual([]);
    expect(decoded.catchFrames.some((f) => f.x === 220 && f.dashing)).toBe(
      true,
    );
  });
});

describe("simulateCatchJudgments", () => {
  test("catches a fruit under the plate", () => {
    const { judgments, summary } = simulateCatchJudgments({
      hitObjects: [{ type: "fruit", x: 200, timeMs: 1000, hyperDash: false }],
      frames: [
        { tMs: 0, x: 200, dashing: false },
        { tMs: 1000, x: 200, dashing: false },
      ],
      circleSize: 4,
      mods: parseScoreMods("[]"),
    });
    expect(judgments[0]!.result).toBe("great");
    expect(summary.counts.miss).toBe(0);
  });
});
