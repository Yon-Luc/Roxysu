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

  test("computes timing-accurate slider ticks", () => {
    const chart = parseStdChart(`osu file format v14

[General]
StackLeniency: 0.7
Mode: 0

[Difficulty]
CircleSize:4
OverallDifficulty:6
ApproachRate:7
SliderMultiplier:1.4
SliderTickRate:2

[TimingPoints]
0,500,4,2,0,100,1,0

[HitObjects]
128,96,1500,2,0,L|256:96,1,300`);

    const slider = chart.hitObjects.find((o) => o.type === "slider");
    expect(slider).toBeDefined();
    if (slider && slider.type === "slider") {
      // spanDuration = (300 / (1.4*100*1)) * 500 ≈ 1071ms; interval = 500/2.
      expect(slider.ticks.length).toBe(4);
      expect(slider.ticks.map((t) => t.tMs)).toEqual([
        1750, 2000, 2250, 2500,
      ]);
      expect(slider.ticks[0]!.frac).toBeCloseTo(0.2333, 2);
      expect(slider.ticks[3]!.frac).toBeCloseTo(0.9333, 2);
      // Ticks never land on the tail.
      expect(slider.ticks[3]!.tMs).toBeLessThan(slider.endMs);
    }
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

  test("scores ticks and tail on a held slider, spinner hold resolves", () => {
    const frames = [
      { tMs: 0, x: 100, y: 100, buttons: 0 },
      { tMs: 990, x: 100, y: 100, buttons: 1 },
      { tMs: 1250, x: 125, y: 100, buttons: 1 },
      { tMs: 1500, x: 150, y: 100, buttons: 1 },
      { tMs: 1750, x: 175, y: 100, buttons: 1 },
      { tMs: 2000, x: 200, y: 100, buttons: 1 },
      { tMs: 2050, x: 200, y: 100, buttons: 0 },
      { tMs: 2500, x: 256, y: 192, buttons: 1 },
      { tMs: 2750, x: 256, y: 192, buttons: 1 },
      { tMs: 3000, x: 256, y: 192, buttons: 0 },
    ];
    const { judgments, summary } = simulateStdJudgments({
      hitObjects: [
        {
          type: "slider",
          x: 100,
          y: 100,
          timeMs: 1000,
          endMs: 2000,
          repeats: 1,
          pixelLength: 100,
          stackX: 100,
          stackY: 100,
          path: [
            { x: 100, y: 100 },
            { x: 125, y: 100 },
            { x: 150, y: 100 },
            { x: 175, y: 100 },
            { x: 200, y: 100 },
          ],
          ticks: [
            { frac: 0.25, tMs: 1250 },
            { frac: 0.5, tMs: 1500 },
            { frac: 0.75, tMs: 1750 },
          ],
        },
        {
          type: "spinner",
          timeMs: 2500,
          endMs: 3000,
        },
      ],
      frames,
      circleSize: 4,
      overallDifficulty: 5,
      mods: parseScoreMods("[]"),
    });
    const head = judgments.find(
      (j) => j.kind === "head" && j.noteIndex === 0,
    );
    expect(head).toBeDefined();
    expect(head!.result).not.toBe("miss");
    const ticks = judgments.filter(
      (j) => j.kind === "tick" && j.noteIndex === 0,
    );
    expect(ticks).toHaveLength(3);
    expect(ticks.every((t) => t.result === "great")).toBe(true);
    const tail = judgments.find(
      (j) => j.kind === "tail" && j.noteIndex === 0,
    );
    expect(tail).toBeDefined();
    expect(tail!.result).toBe("great");
    const spin = judgments.find(
      (j) => j.noteIndex === 1,
    );
    expect(spin).toBeDefined();
    expect(spin!.result).not.toBe("miss");
    expect(spin!.kind).toBe("head");
    expect(summary.counts.miss).toBe(0);
  });
});
