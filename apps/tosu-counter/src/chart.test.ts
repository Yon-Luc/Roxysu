import { describe, expect, test } from "bun:test";
import { modsFlagsFromAcronyms, parseManiaNotes } from "./chart";

function maniaOsu(noteLines: string[], mode = "3"): string {
  return [
    "osu file format v14",
    "",
    "[General]",
    `Mode: ${mode}`,
    "",
    "[Metadata]",
    "Title: Test",
    "Artist: Tester",
    "Creator: roxy",
    "Version: NM",
    "",
    "[Difficulty]",
    "CircleSize:7",
    "OverallDifficulty:8",
    "",
    "[TimingPoints]",
    "0,333.333333333333,4,2,1,60,1,0",
    "",
    "[HitObjects]",
    ...noteLines,
  ].join("\n");
}

describe("modsFlagsFromAcronyms", () => {
  test("detects IN / HO / MR and ignores others", () => {
    const flags = modsFlagsFromAcronyms(["DT", "IN", "MR"]);
    expect(flags.invert).toBe(true);
    expect(flags.holdOff).toBe(false);
    expect(flags.mirror).toBe(true);
  });

  test("empty mods produce no conversions", () => {
    expect(modsFlagsFromAcronyms([])).toEqual({
      invert: false,
      holdOff: false,
      mirror: false,
    });
    expect(modsFlagsFromAcronyms(null)).toEqual({
      invert: false,
      holdOff: false,
      mirror: false,
    });
  });
});

describe("parseManiaNotes", () => {
  test("rejects non-mania modes", () => {
    const result = parseManiaNotes(
      maniaOsu(["440,192,1105,1,0,0:0:0:0:"], "0"),
      modsFlagsFromAcronyms([]),
    );
    expect(result).toEqual({ ok: false, kind: "not-mania" });
  });

  test("extracts sorted notes with columns and LN ends", () => {
    // 7K: x = col * 512/7 rounded; holds end at y != x.
    // col 0 -> x=0? lazer rounds to center of column; parser maps by x.
    const result = parseManiaNotes(
      maniaOsu([
        "73,73,1000,128,0,1600:0:0:0:0:", // col 0 hold
        "220,220,500,1,0,0:0:0:0:", // col 1 tap
        "366,366,300,1,0,0:0:0:0:", // col 2 tap
        "513,513,700,1,0,0:0:0:0:", // col 3 tap
        "660,660,800,1,0,0:0:0:0:", // col 4 tap
        "806,806,900,1,0,0:0:0:0:", // col 5 tap
        "953,953,1200,1,0,0:0:0:0:", // col 6 tap
      ]),
      modsFlagsFromAcronyms([]),
    );
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
    expect(result.chart.columnCount).toBe(7);
    const starts = result.chart.notes.map((n) => n.startMs);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    const hold = result.chart.notes.find((n) => n.startMs === 1000);
    expect(hold?.endMs).toBe(1600);
    expect(result.chart.notes.length).toBe(7);
  });

  test("mirror flips columns after conversion", () => {
    const base = maniaOsu(["73,73,500,1,0,0:0:0:0:"]); // col 0
    const nm = parseManiaNotes(base, modsFlagsFromAcronyms([]));
    const mr = parseManiaNotes(base, modsFlagsFromAcronyms(["MR"]));
    if (!nm.ok || !mr.ok) throw new Error("expected ok");
    expect(nm.chart.notes[0]!.column).toBe(0);
    expect(mr.chart.notes[0]!.column).toBe(6);
  });

  test("Invert converts taps to LNs ending before the next same-column note", () => {
    // Two taps in column 1, 400ms apart.
    const osu = maniaOsu([
      "220,220,1000,1,0,0:0:0:0:",
      "220,220,1400,1,0,0:0:0:0:",
    ]);
    const nm = parseManiaNotes(osu, modsFlagsFromAcronyms([]));
    const inv = parseManiaNotes(osu, modsFlagsFromAcronyms(["IN"]));
    if (!nm.ok || !inv.ok) throw new Error("expected ok");
    expect(nm.chart.notes.every((n) => n.endMs <= n.startMs + 20)).toBe(true);
    const firstLn = inv.chart.notes[0]!;
    expect(firstLn.endMs).toBeGreaterThan(firstLn.startMs + 20);
    expect(firstLn.endMs).toBeLessThan(1400);
  });
});
