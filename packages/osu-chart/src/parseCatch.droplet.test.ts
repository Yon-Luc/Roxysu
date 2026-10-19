import { describe, expect, test } from "bun:test";
import { parseCatchChart } from "./parseCatch";

const VERTICAL_STREAM = `osu file format v14

[General]
Mode: 2

[Difficulty]
CircleSize:5
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1
SliderTickRate:1

[TimingPoints]
0,1000,4,2,0,100,1,0

[HitObjects]
256,192,1000,2,0,L|256:392,1,200
`;

const SHORT_STREAM = `osu file format v14

[General]
Mode: 2

[Difficulty]
CircleSize:5
OverallDifficulty:5
ApproachRate:5
SliderMultiplier:1
SliderTickRate:1

[TimingPoints]
0,100,4,2,0,100,1,0

[HitObjects]
256,192,1000,2,0,L|266:192,1,10
`;

describe("parseCatchChart tiny droplets", () => {
  test("spaces tiny droplets instead of emitting one every 16ms", () => {
    const chart = parseCatchChart(VERTICAL_STREAM);
    expect(chart.status).toBe("OK");
    const tinies = chart.hitObjects.filter(
      (o) => o.type === "droplet" && o.kind === "tiny",
    );
    const duration = 2000;
    expect(tinies.length).toBeGreaterThan(0);
    expect(tinies.length).toBeLessThan(duration / 16);

    const times = tinies.map((o) => o.timeMs).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThan(50);
    }

    const larges = chart.hitObjects.filter(
      (o) => o.type === "droplet" && o.kind === "large",
    );
    for (const drop of larges) {
      expect(drop.x).toBeCloseTo(256, 5);
    }

    let leftPath = false;
    for (const drop of tinies) {
      expect(Math.abs(drop.x - 256)).toBeLessThanOrEqual(20);
      if (Math.abs(drop.x - 256) > 0.01) leftPath = true;
    }
    expect(leftPath).toBe(true);
  });

  test("skips tiny droplets when slider events are 80ms apart or closer", () => {
    const chart = parseCatchChart(SHORT_STREAM);
    const tinies = chart.hitObjects.filter(
      (o) => o.type === "droplet" && o.kind === "tiny",
    );
    expect(tinies).toHaveLength(0);
  });
});
