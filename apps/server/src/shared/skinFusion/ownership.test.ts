import { describe, expect, test } from "bun:test";
import { PathIndex } from "./fileMap";
import { parseIni, findSection } from "./iniModel";
import {
  classifyFile,
  columnNoteType,
  fontPrefixRef,
  providedRulesets,
  resolveManiaRefs,
} from "./ownership";

const b = (n: number) => new Uint8Array([n]);

describe("classifyFile", () => {
  test("routes root-level names to their ruleset", () => {
    expect(classifyFile("hitcircle.png")).toBe("osu");
    expect(classifyFile("hitcircle@2x.png")).toBe("osu");
    expect(classifyFile("hit300-1.png")).toBe("osu");
    expect(classifyFile("default-5.png")).toBe("osu");
    expect(classifyFile("sliderb12.png")).toBe("osu");
    expect(classifyFile("fruit-apple-overlay.png")).toBe("fruits");
    expect(classifyFile("lighting.png")).toBe("fruits");
    expect(classifyFile("taiko-drum-inner.png")).toBe("taiko");
    expect(classifyFile("taiko-normal-hitnormal.wav")).toBe("taiko");
    expect(classifyFile("pippidonidle0.png")).toBe("taiko");
    expect(classifyFile("mania-note1.png")).toBe("mania");
    expect(classifyFile("lightingN.png")).toBe("mania");
  });

  test("keeps score digits, menu art and sample sets shared", () => {
    expect(classifyFile("score-0.png")).toBe("shared");
    expect(classifyFile("menu-back.png")).toBe("shared");
    expect(classifyFile("normal-hitnormal.wav")).toBe("shared");
    expect(classifyFile("soft-slidertick.ogg")).toBe("shared");
  });

  test("ignores layout, ini and source art", () => {
    for (const p of ["skin.ini", "7k.ini", "Playfield.json", "credits.txt", "x.psd", "applause.mp3.sfk"]) {
      expect(classifyFile(p)).toBe("ignored");
    }
  });
});

describe("mania refs", () => {
  test("note types follow the stable column pattern", () => {
    expect(columnNoteType(4, 0)).toBe("1");
    expect(columnNoteType(4, 1)).toBe("2");
    expect(columnNoteType(7, 3)).toBe("S");
  });

  test("named keys win and the implicit default is used otherwise", () => {
    const doc = parseIni("[Mania]\nKeys: 4\nNoteImage0: 4k\\custom.png\nStageHint: hint\n");
    const block = findSection(doc, "Mania")!;
    const index = new PathIndex(
      new Map([
        ["4k/custom.png", b(1)],
        ["mania-note2.png", b(2)],
        ["hint.png", b(3)],
        ["lightingN.png", b(4)],
        ["mania-hit300g-0.png", b(5)],
        ["mania-hit300g-1.png", b(6)],
      ]),
    );
    const refs = resolveManiaRefs(index, 4, block);
    const byKey = new Map(refs.map((r) => [r.target.key, r]));
    expect(byKey.get("NoteImage0")).toMatchObject({ base: "4k/custom", named: true, keyExt: ".png" });
    expect(byKey.get("NoteImage1")).toMatchObject({ base: "mania-note2", named: false });
    expect(byKey.get("StageHint")?.base).toBe("hint");
    expect(byKey.get("LightingN")?.base).toBe("lightingN");
    expect(byKey.get("Hit300g")?.files).toHaveLength(2);
    expect(byKey.has("NoteImage1H")).toBe(false);
  });

  test("font prefix groups every digit under one ref", () => {
    const index = new PathIndex(
      new Map([
        ["fonts/num-0.png", b(1)],
        ["fonts/num-1@2x.png", b(2)],
      ]),
    );
    const ref = fontPrefixRef(index, "ScorePrefix", "fonts\\num")!;
    expect(ref.base).toBe("fonts/num");
    expect(ref.files).toHaveLength(2);
    expect(fontPrefixRef(index, "ScorePrefix", "missing")).toBeNull();
  });

  test("providedRulesets lists the rulesets a skin ships files for", () => {
    expect(providedRulesets(["hitcircle.png", "fruit-apple.png", "mania-note1.png"])).toEqual(["osu", "fruits"]);
  });
});
