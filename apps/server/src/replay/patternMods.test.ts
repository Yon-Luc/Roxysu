import { describe, expect, test } from "bun:test";
import { OsuFileParser } from "@roxysu/osu-chart";
import { applyManiaPatternMods } from "./loadChart";

const OSU_TEMPLATE = (hitObjects: string) => `osu file format v14

[General]
Mode: 3

[Metadata]
Title:fixture
Artist:pattern-mods
Creator:tester
Version:4K Test

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:8
ApproachRate:8
SliderMultiplier:1.8

[TimingPoints]
0,500,4,2,0,60,1,0

[HitObjects]
${hitObjects}`;

const RICE = "64,192,{t},1,0,0:0:0:0:";
const LN = "64,192,{t},128,0,{end}:0:0:0:";

function parse(hitObjects: string): OsuFileParser {
  const parser = new OsuFileParser(OSU_TEMPLATE(hitObjects));
  parser.process();
  return parser;
}

function notes(parser: OsuFileParser) {
  return parser.columns.map((column, i) => ({
    column,
    startMs: parser.noteStarts[i]!,
    endMs: parser.noteEnds[i]!,
    isLn: (parser.noteTypes[i]! & 128) !== 0,
  }));
}

describe("applyManiaPatternMods", () => {
  test("no mods keeps the chart untouched", () => {
    const parser = parse([RICE.replace("{t}", "1000")].join("\n"));
    applyManiaPatternMods(parser, undefined);
    expect(notes(parser)).toEqual([
      { column: 0, startMs: 1000, endMs: 1000, isLn: false },
    ]);
  });

  test("Invert converts same-column rice pairs to LNs ending before the next note", () => {
    // Beat length 500 → LN duration max(500/2, 500 − 500/4) = 375.
    const parser = parse(
      [
        RICE.replace("{t}", "0"),
        RICE.replace("{t}", "500"),
        RICE.replace("{t}", "1000"),
      ].join("\n"),
    );
    applyManiaPatternMods(parser, { invert: true });
    const converted = notes(parser);
    expect(converted).toHaveLength(2);
    for (const n of converted) {
      expect(n.column).toBe(0);
      expect(n.isLn).toBe(true);
    }
    expect(converted[0]).toMatchObject({ startMs: 0, endMs: 375 });
    expect(converted[1]).toMatchObject({ startMs: 500, endMs: 875 });
  });

  test("Invert leaves the last note of a column untouched", () => {
    const parser = parse(RICE.replace("{t}", "0"));
    applyManiaPatternMods(parser, { invert: true });
    expect(notes(parser)).toEqual([]);
  });

  test("Hold Off flattens LNs to rice", () => {
    const parser = parse(LN.replace("{t}", "100").replace("{end}", "900"));
    applyManiaPatternMods(parser, { holdOff: true });
    expect(notes(parser)).toEqual([
      { column: 0, startMs: 100, endMs: 0, isLn: false },
    ]);
  });

  test("Invert followed by Hold Off nets rice", () => {
    const parser = parse(
      [RICE.replace("{t}", "0"), RICE.replace("{t}", "500")].join("\n"),
    );
    applyManiaPatternMods(parser, { invert: true, holdOff: true });
    expect(notes(parser)).toEqual([
      { column: 0, startMs: 0, endMs: 0, isLn: false },
    ]);
  });

  test("Invert rebuilds columns from starts; existing LN tails are replaced", () => {
    const parser = parse(
      [
        RICE.replace("{t}", "0"),
        LN.replace("{t}", "500").replace("{end}", "900"),
        RICE.replace("{t}", "1000"),
      ].join("\n"),
    );
    applyManiaPatternMods(parser, { invert: true });
    const converted = notes(parser);
    // Starts [0, 500, 1000] become LNs ending before the next start; the
    // original 900ms tail is discarded like any other start-only rebuild.
    expect(converted).toHaveLength(2);
    expect(converted[0]).toMatchObject({ column: 0, startMs: 0, endMs: 375 });
    expect(converted[1]).toMatchObject({
      column: 0,
      startMs: 500,
      endMs: 875,
    });
  });
});
