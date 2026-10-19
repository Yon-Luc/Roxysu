import { describe, expect, test } from "bun:test";
import {
  findSection,
  getValue,
  iniToBytes,
  maniaBlocks,
  parseIni,
  parseIniBytes,
  removeKey,
  serializeIni,
  setValue,
} from "./iniModel";

const SAMPLE = [
  "[General]",
  "Name: yon2025",
  "// a comment",
  "Version: latest",
  "",
  "[Colours]",
  "Combo1: 145,229,103",
  "[Mania]",
  "Keys: 4",
  "ColumnWidth: 68,68,68,68 // inline",
  "NoteImage0: 7k\\prayedit\\mania-note2",
  "[Mania]",
  "Keys: 7",
  "NoteImage0: 7k\\x",
  "",
].join("\r\n");

describe("iniModel", () => {
  test("round-trips untouched text byte for byte", () => {
    const doc = parseIni(SAMPLE);
    expect(serializeIni(doc)).toBe(SAMPLE);
  });

  test("round-trips LF files and preserves the BOM", () => {
    const text = "[General]\nName: a\n";
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    const doc = parseIniBytes(bytes);
    expect(doc.bom).toBe(true);
    expect(doc.eol).toBe("\n");
    expect([...iniToBytes(doc)]).toEqual([...bytes]);
  });

  test("decodes UTF-16 LE", () => {
    const text = "[General]\r\nName: wide\r\n";
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe], 0);
    for (let i = 0; i < text.length; i += 1) {
      bytes[2 + i * 2] = text.charCodeAt(i);
    }
    const doc = parseIniBytes(bytes);
    expect(getValue(findSection(doc, "general")!, "name")).toBe("wide");
  });

  test("reads values case-insensitively, last occurrence wins, strips inline comments", () => {
    const doc = parseIni("[General]\nname: a\nNAME: b\nWidth: 4 // note\n");
    const general = findSection(doc, "General")!;
    expect(getValue(general, "Name")).toBe("b");
    expect(getValue(general, "width")).toBe("4");
  });

  test("setValue rewrites only the edited line and keeps others verbatim", () => {
    const doc = parseIni(SAMPLE);
    const block = maniaBlocks(doc).get(4)!;
    setValue(block, "NoteImage0", "fusion\\d0\\mania-note2");
    const out = serializeIni(doc);
    expect(out).toContain("NoteImage0: fusion\\d0\\mania-note2");
    expect(out).toContain("ColumnWidth: 68,68,68,68 // inline");
    expect(out).toContain("// a comment");
    expect(out).toContain("NoteImage0: 7k\\x");
  });

  test("setValue appends missing keys and removeKey deletes them", () => {
    const doc = parseIni("[Mania]\nKeys: 4\n");
    const block = findSection(doc, "Mania")!;
    setValue(block, "StageHint", "a");
    expect(getValue(block, "stagehint")).toBe("a");
    removeKey(block, "StageHint");
    expect(getValue(block, "stagehint")).toBeUndefined();
  });

  test("maniaBlocks indexes by Keys and ignores invalid counts", () => {
    const doc = parseIni("[Mania]\nKeys: 4\n[Mania]\nKeys: 4\nX: 1\n[Mania]\nKeys: 99\n[Mania]\nKeys: 7\n");
    const blocks = maniaBlocks(doc);
    expect([...blocks.keys()]).toEqual([4, 7]);
    expect(getValue(blocks.get(4)!, "x")).toBeUndefined();
  });
});
