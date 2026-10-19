import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import { PathIndex, resolveImageRef, unzipSkinFiles } from "./fileMap";
import {
  findSection,
  getValue,
  maniaBlocks,
  parseIniBytes,
} from "./iniModel";
import {
  NONE_DONOR,
  buildDonor,
  formatReport,
  planFusion,
  type SkinDonor,
} from "./plan";
import { toOskBytes } from "./zip";

const enc = new TextEncoder();
const png = (...n: number[]) => new Uint8Array([0x89, 0x50, ...n]);

function donor(
  id: string,
  files: Record<string, string | Uint8Array>,
): SkinDonor {
  const map = new Map<string, Uint8Array>();
  for (const [path, value] of Object.entries(files)) {
    map.set(path, typeof value === "string" ? enc.encode(value) : value);
  }
  return buildDonor({ id, label: id.toUpperCase(), files: map });
}

const layout = (entries: Record<string, unknown[]>, version = 1) =>
  JSON.stringify({ Version: version, DrawableInfo: entries });

function iniOf(files: Map<string, Uint8Array>) {
  return parseIniBytes(files.get("skin.ini")!);
}

/** Every image a [Mania] / [Fonts] key names must exist in the output. */
function assertIniImagesExist(files: Map<string, Uint8Array>) {
  const index = new PathIndex(files);
  const ini = iniOf(files);
  for (const section of ini.sections) {
    for (const line of section.lines) {
      if (line.kind !== "kv") continue;
      const key = line.key.toLowerCase();
      const isImage =
        /^(noteimage\d+[hlt]?|keyimage\d+d?|stage(left|right|hint|bottom|light)|lighting[nl]|warningarrow|hit(0|50|100|200|300|300g))$/.test(
          key,
        ) && section.name.toLowerCase() === "mania";
      if (isImage) {
        expect(resolveImageRef(index, line.value), `${section.name}.${line.key}=${line.value}`).not.toBeNull();
      }
    }
  }
}

const SKIN_A = {
  "skin.ini": [
    "[General]",
    "Name: A",
    "Author: authorA",
    "Version: 2.5",
    "[Fonts]",
    "HitCirclePrefix: fonts\\num",
    "[Mania]",
    "Keys: 4",
    "HitPosition: 400",
    "NoteImage0: 4k\\note",
    "",
  ].join("\n"),
  "hitcircle.png": png(1),
  "cursor.png": png(2),
  "score-0.png": png(3),
  "menu-back.png": png(4),
  "mania-note1.png": png(10),
  "mania-note2.png": png(11),
  "mania-stage-hint.png": png(12),
  "4k/note.png": png(13),
  "4k/note@2x.png": png(14),
  "fonts/num-0.png": png(15),
  "taiko-drum-inner.png": png(20),
  "fruit-apple.png": png(30),
  "normal-hitnormal.wav": new Uint8Array([7, 7]),
  "credits.txt": "a",
};

const SKIN_B = {
  "skin.ini": [
    "[General]",
    "Name: B",
    "Version: latest",
    "[Mania]",
    "Keys: 7",
    "HitPosition: 440",
    "",
  ].join("\n"),
  "hitcircle.png": png(101),
  "cursor.png": png(102),
  "score-0.png": png(103),
  "menu-back.png": png(104),
  "mania-note1.png": png(110),
  "mania-note2.png": png(111),
  "mania-stage-hint.png": png(112),
  "taiko-drum-inner.png": png(120),
  "fruit-apple.png": png(130),
  "normal-hitnormal.wav": new Uint8Array([8, 8]),
};

describe("planFusion", () => {
  test("a single donor yields its own skin without moved files", () => {
    const a = donor("a", SKIN_A);
    const { files, report } = planFusion({
      name: "Solo",
      creator: "me",
      donors: [a],
      baseId: "a",
      slots: {},
    });
    expect(report.maniaNamespaced).toBe(false);
    expect(report.relocated).toHaveLength(0);
    expect([...files.keys()].some((p) => p.startsWith("fusion/"))).toBe(false);
    expect(files.has("hitcircle.png")).toBe(true);
    expect(files.has("4k/note@2x.png")).toBe(true);
    expect(files.has("fonts/num-0.png")).toBe(true);
    expect(files.has("credits.txt")).toBe(true);
    const ini = iniOf(files);
    expect(getValue(findSection(ini, "General")!, "Name")).toBe("Solo");
    expect(getValue(maniaBlocks(ini).get(4)!, "NoteImage0")).toBe("4k\\note");
    assertIniImagesExist(files);
  });

  test("different donors for mania key counts never share a path", () => {
    const a = donor("a", SKIN_A);
    const b = donor("b", SKIN_B);
    const { files, report } = planFusion({
      name: "Mix",
      creator: "me",
      donors: [a, b],
      baseId: "a",
      slots: { "mania:4": "a", "mania:7": "b" },
    });
    expect(report.maniaNamespaced).toBe(true);
    // No mania default-named file survives at the root, so a block that lacks
    // an image cannot pick up another skin's file.
    expect(files.has("mania-note1.png")).toBe(false);
    expect(files.has("fusion/d0-a/mania-note1.png")).toBe(true);
    expect(files.has("fusion/d1-b/mania-note1.png")).toBe(true);
    const blocks = maniaBlocks(iniOf(files));
    expect(getValue(blocks.get(4)!, "NoteImage0")).toBe("fusion\\d0-a\\4k\\note");
    expect(getValue(blocks.get(4)!, "NoteImage1")).toBe("fusion\\d0-a\\mania-note2");
    expect(getValue(blocks.get(7)!, "NoteImage0")).toBe("fusion\\d1-b\\mania-note1");
    expect(getValue(blocks.get(7)!, "StageHint")).toBe("fusion\\d1-b\\mania-stage-hint");
    // Untouched block numbers stay verbatim.
    expect(getValue(blocks.get(4)!, "HitPosition")).toBe("400");
    expect(getValue(blocks.get(7)!, "HitPosition")).toBe("440");
    assertIniImagesExist(files);
  });

  test("@2x and SD files of one reference move together", () => {
    const a = donor("a", SKIN_A);
    const b = donor("b", SKIN_B);
    const { files } = planFusion({
      name: "Mix",
      creator: "",
      donors: [a, b],
      baseId: "b",
      slots: { "mania:4": "a", "mania:7": "b" },
    });
    expect(files.has("fusion/d0-a/4k/note.png")).toBe(true);
    expect(files.has("fusion/d0-a/4k/note@2x.png")).toBe(true);
  });

  test("ruleset slots take their files from the chosen donor and shared files from base", () => {
    const a = donor("a", SKIN_A);
    const b = donor("b", SKIN_B);
    const { files } = planFusion({
      name: "Mix",
      creator: "",
      donors: [a, b],
      baseId: "b",
      slots: { osu: "a", taiko: "a", fruits: "b" },
    });
    expect(files.get("hitcircle.png")).toEqual(png(1));
    expect(files.get("cursor.png")).toEqual(png(2));
    expect(files.get("taiko-drum-inner.png")).toEqual(png(20));
    expect(files.get("fruit-apple.png")).toEqual(png(130));
    // score digits and menu art are shared: base (B) wins.
    expect(files.get("score-0.png")).toEqual(png(103));
    expect(files.get("menu-back.png")).toEqual(png(104));
    expect(files.get("normal-hitnormal.wav")).toEqual(new Uint8Array([8, 8]));
  });

  test("hit circle prefix follows the osu donor", () => {
    const a = donor("a", SKIN_A);
    const b = donor("b", SKIN_B);
    const { files } = planFusion({
      name: "Mix",
      creator: "",
      donors: [a, b],
      baseId: "b",
      slots: { osu: "a" },
    });
    const fonts = findSection(iniOf(files), "Fonts")!;
    expect(getValue(fonts, "HitCirclePrefix")).toBe("fonts\\num");
    expect(files.has("fonts/num-0.png")).toBe(true);

    const back = planFusion({
      name: "Mix",
      creator: "",
      donors: [a, b],
      baseId: "a",
      slots: { osu: "b" },
    });
    const fonts2 = findSection(iniOf(back.files), "Fonts");
    expect(fonts2 && getValue(fonts2, "HitCirclePrefix")).toBeUndefined();
    expect(back.files.has("fonts/num-0.png")).toBe(false);
  });

  test("a mania slot set to none leaves no block for that key count", () => {
    const a = donor("a", SKIN_A);
    const { files } = planFusion({
      name: "Mix",
      creator: "",
      donors: [a],
      baseId: "a",
      slots: { "mania:4": NONE_DONOR },
    });
    expect(maniaBlocks(iniOf(files)).has(4)).toBe(false);
    expect(files.has("4k/note.png")).toBe(false);
  });

  test("a slot donor with no [Mania] block gets a synthetic block when its images move", () => {
    const a = donor("a", SKIN_A);
    const b = donor("b", SKIN_B);
    const { files } = planFusion({
      name: "Mix",
      creator: "",
      donors: [a, b],
      baseId: "a",
      slots: { "mania:4": "a", "mania:5": "b" },
    });
    const block5 = maniaBlocks(iniOf(files)).get(5)!;
    expect(getValue(block5, "Keys")).toBe("5");
    expect(getValue(block5, "NoteImage0")).toBe("fusion\\d1-b\\mania-note1");
    assertIniImagesExist(files);
  });

  test("layout JSON is composed per ruleset and copied verbatim", () => {
    const entry = (type: string, x: number) => ({
      Type: `${type}, osu.Game, Version=2025.1029.1.0, Culture=neutral, PublicKeyToken=null`,
      Position: { x, y: 1 },
      Anchor: 17,
    });
    const a = donor("a", {
      ...SKIN_A,
      "MainHUDComponents.json": layout(
        { global: [entry("G.A", 1)], osu: [entry("O.A", 2)], mania: [entry("M.A", 3)], fruits: [entry("F.A", 4)] },
        0,
      ),
      "Playfield.json": layout({ osu: [entry("P.A", 5)], mania: [] }),
      "SongSelect.json": layout({ global: [entry("S.A", 6)] }),
    });
    const b = donor("b", {
      ...SKIN_B,
      "MainHUDComponents.json": layout(
        { global: [entry("G.B", 1)], osu: [entry("O.B", 2)], mania: [entry("M.B", 3)], fruits: [entry("F.B", 4)] },
        2,
      ),
      "SongSelect.json": layout({ global: [entry("S.B", 6)] }),
    });
    const { files } = planFusion({
      name: "Mix",
      creator: "",
      donors: [a, b],
      baseId: "a",
      slots: { osu: "b", fruits: "a", hudGlobal: "b", songSelect: "b", "mania:4": "a", "mania:7": "b" },
    });
    const hud = JSON.parse(new TextDecoder().decode(files.get("MainHUDComponents.json")!));
    // Lowest contributing version, so lazer's own migrations still run.
    expect(hud.Version).toBe(0);
    expect(hud.DrawableInfo.global[0].Type).toStartWith("G.B,");
    expect(hud.DrawableInfo.osu[0].Type).toStartWith("O.B,");
    expect(hud.DrawableInfo.fruits[0].Type).toStartWith("F.A,");
    // maniaLayout defaults to the first mania slot's donor (4K -> a).
    expect(hud.DrawableInfo.mania[0].Type).toStartWith("M.A,");
    // Assembly-qualified type names are untouched.
    expect(hud.DrawableInfo.osu[0].Type).toContain("Version=2025.1029.1.0");
    const play = JSON.parse(new TextDecoder().decode(files.get("Playfield.json")!));
    // osu slot is donor b, which has no Playfield.json: no osu entry, mania [] kept from a.
    expect(play.DrawableInfo.osu).toBeUndefined();
    expect(play.DrawableInfo.mania).toEqual([]);
    const song = JSON.parse(new TextDecoder().decode(files.get("SongSelect.json")!));
    expect(song.DrawableInfo.global[0].Type).toStartWith("S.B,");
  });

  test("a layout sprite whose name is taken by different bytes is renamed and rewritten", () => {
    const sprite = (name: string) => ({
      Type: "osu.Game.Skinning.SkinnableSprite, osu.Game",
      Settings: { sprite_name: name },
      Children: [],
    });
    const a = donor("a", {
      ...SKIN_A,
      "MainHUDComponents.json": layout({ global: [sprite("lara2.png")], osu: [sprite("menu-back.png")] }),
      "lara2.png": png(40),
    });
    const b = donor("b", SKIN_B);
    const { files, report } = planFusion({
      name: "Mix",
      creator: "",
      donors: [a, b],
      baseId: "b",
      slots: { hudGlobal: "a", osu: "a" },
    });
    const hud = JSON.parse(new TextDecoder().decode(files.get("MainHUDComponents.json")!));
    expect(hud.DrawableInfo.global[0].Settings.sprite_name).toBe("lara2.png");
    expect(files.get("lara2.png")).toEqual(png(40));
    // menu-back.png already comes from base B with other bytes.
    expect(hud.DrawableInfo.osu[0].Settings.sprite_name).toBe("menu-back__d0-a.png");
    expect(files.get("menu-back__d0-a.png")).toEqual(png(4));
    expect(files.get("menu-back.png")).toEqual(png(104));
    expect(report.relocated.some((r) => r.reason === "layout sprite name conflict")).toBe(true);
  });

  test("layout-only donors can feed layouts and warn when used for images", () => {
    const a = donor("a", SKIN_A);
    const modified = donor("m", {
      "skin.ini": "[General]\nName: m\n",
      "skininfo.json": JSON.stringify({ Name: "m", InstantiationInfo: "osu.Game.Skinning.ArgonSkin, osu.Game" }),
      "SongSelect.json": layout({ global: [] }),
    });
    expect(modified.hasAssets).toBe(false);
    expect(modified.instantiationInfo).toContain("ArgonSkin");
    const ok = planFusion({
      name: "x",
      creator: "",
      donors: [a, modified],
      baseId: "a",
      slots: { songSelect: "m" },
    });
    expect(ok.files.has("SongSelect.json")).toBe(true);
    expect(ok.report.warnings.some((w) => w.includes("layout-only"))).toBe(false);
    const bad = planFusion({
      name: "x",
      creator: "",
      donors: [a, modified],
      baseId: "a",
      slots: { osu: "m" },
    });
    expect(bad.report.warnings.some((w) => w.includes("layout-only"))).toBe(true);
  });

  test("warns on Version mismatch and global [General] differences", () => {
    const a = donor("a", SKIN_A);
    const b = donor("b", SKIN_B);
    const { report } = planFusion({
      name: "x",
      creator: "",
      donors: [a, b],
      baseId: "a",
      slots: { osu: "b" },
    });
    expect(report.warnings.some((w) => w.includes("Version differs"))).toBe(true);
  });

  test("output skininfo.json is a legacy skin with the fusion name", () => {
    const a = donor("a", SKIN_A);
    const { files } = planFusion({ name: "Fusion 1", creator: "yon", donors: [a], baseId: "a", slots: {} });
    const info = JSON.parse(new TextDecoder().decode(files.get("skininfo.json")!));
    expect(info).toEqual({
      Name: "Fusion 1",
      Creator: "yon",
      InstantiationInfo: "osu.Game.Skinning.LegacySkin, osu.Game",
    });
  });

  test("throws over the size cap and without a base", () => {
    const a = donor("a", SKIN_A);
    expect(() =>
      planFusion({ name: "x", creator: "", donors: [a], baseId: "a", slots: {}, options: { maxBytes: 10 } }),
    ).toThrow(/limit/);
    expect(() =>
      planFusion({ name: "x", creator: "", donors: [a], baseId: "zzz", slots: {} }),
    ).toThrow();
  });

  test("case-only path differences count as one path", () => {
    const a = donor("a", { ...SKIN_A, "MANIA-NOTE1.PNG": png(10) });
    const b = donor("b", { ...SKIN_B, "Mania-Note1.png": png(110) });
    const { files } = planFusion({
      name: "x",
      creator: "",
      donors: [a, b],
      baseId: "a",
      slots: { "mania:4": "a", "mania:7": "b" },
      options: { maniaNamespacing: "never" },
    });
    const lower = [...files.keys()].map((p) => p.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    assertIniImagesExist(files);
  });

  test("report text and osk bytes round-trip with safe entry names", () => {
    const a = donor("a", SKIN_A);
    const b = donor("b", SKIN_B);
    const { files, report } = planFusion({
      name: "Mix",
      creator: "",
      donors: [a, b],
      baseId: "a",
      slots: { "mania:4": "a", "mania:7": "b" },
    });
    expect(formatReport(report)).toContain("mania:7: B");
    const osk = toOskBytes(files, formatReport(report));
    const round = unzipSkinFiles(osk);
    expect(round.has("skin.ini")).toBe(true);
    expect(round.has("fusion-report.txt")).toBe(true);
    for (const path of round.keys()) {
      expect(path.includes("..")).toBe(false);
      expect(path.startsWith("/")).toBe(false);
    }
    void zipSync;
  });
});

describe("layout warnings", () => {
  test("flags custom ruleset components and keeps v0 layouts migratable", () => {
    const bmsEntry = {
      Type: "osu.Game.Rulesets.BmsRuleset.UI.HudComponents.BmsSongProgress, osu.Game.Rulesets.BmsRuleset",
    };
    const a = donor("a", {
      ...SKIN_A,
      "MainHUDComponents.json": layout({ bms: [bmsEntry], global: [] }, 0),
    });
    const { report, files } = planFusion({
      name: "x",
      creator: "",
      donors: [a],
      baseId: "a",
      slots: {},
    });
    expect(report.warnings.some((w) => w.includes("BmsRuleset"))).toBe(true);
    const hud = JSON.parse(new TextDecoder().decode(files.get("MainHUDComponents.json")!));
    expect(hud.Version).toBe(0);
    expect(hud.DrawableInfo.bms).toHaveLength(1);
  });
});
