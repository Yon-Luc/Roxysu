/**
 * Lossless-ish `skin.ini` model: sections of lines, where untouched lines
 * serialise as their original text (comments, blank lines, unknown keys and
 * inline comments survive). Only lines that are edited are rewritten.
 */

export type IniLine =
  | { kind: "kv"; key: string; value: string; raw: string }
  | { kind: "raw"; raw: string };

export type IniSection = {
  /** Section name as written (without brackets). */
  name: string;
  lines: IniLine[];
};

export type IniDoc = {
  /** Lines before the first `[Section]` header. */
  preamble: IniLine[];
  sections: IniSection[];
  /** Source started with a UTF-8 BOM. */
  bom: boolean;
  eol: "\r\n" | "\n";
};

/** Decode skin.ini bytes (UTF-8 with or without BOM, UTF-16 LE/BE). */
export function decodeIniBytes(bytes: Uint8Array): { text: string; bom: boolean } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), bom: false };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), bom: false };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), bom: true };
  }
  const sampleLen = Math.min(64, bytes.length);
  let zeros = 0;
  for (let i = 1; i < sampleLen; i += 2) {
    if (bytes[i] === 0) zeros += 1;
  }
  if (sampleLen >= 8 && zeros > sampleLen / 4) {
    return { text: new TextDecoder("utf-16le").decode(bytes), bom: false };
  }
  return { text: new TextDecoder("utf-8").decode(bytes), bom: false };
}

function stripInlineComment(line: string): string {
  const idx = line.search(/(^|\s)\/\//);
  return idx < 0 ? line : line.slice(0, idx);
}

function parseLine(raw: string): IniLine {
  const content = stripInlineComment(raw).trim();
  if (!content || content.startsWith("[")) return { kind: "raw", raw };
  const eq = content.indexOf(":");
  if (eq < 0) return { kind: "raw", raw };
  return {
    kind: "kv",
    key: content.slice(0, eq).trim(),
    value: content.slice(eq + 1).trim(),
    raw,
  };
}

export function parseIni(text: string, bom = false): IniDoc {
  const eol: IniDoc["eol"] = text.includes("\r\n") ? "\r\n" : "\n";
  const doc: IniDoc = { preamble: [], sections: [], bom, eol };
  let current: IniSection | null = null;
  const lines = text.split(/\r?\n/);
  // A trailing newline yields one empty last element; drop it so serialise adds it back.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const raw of lines) {
    const header = stripInlineComment(raw).trim().match(/^\[([^\]]+)\]$/);
    if (header) {
      current = { name: header[1]!.trim(), lines: [] };
      doc.sections.push(current);
      continue;
    }
    const parsed = parseLine(raw);
    if (current) current.lines.push(parsed);
    else doc.preamble.push(parsed);
  }
  return doc;
}

export function parseIniBytes(bytes: Uint8Array): IniDoc {
  const { text, bom } = decodeIniBytes(bytes);
  return parseIni(text, bom);
}

export function serializeIni(doc: IniDoc): string {
  const out: string[] = [];
  for (const line of doc.preamble) out.push(line.raw);
  for (const section of doc.sections) {
    out.push(`[${section.name}]`);
    for (const line of section.lines) out.push(line.raw);
  }
  return out.join(doc.eol) + doc.eol;
}

export function iniToBytes(doc: IniDoc): Uint8Array {
  const body = new TextEncoder().encode(serializeIni(doc));
  if (!doc.bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

export function sectionKey(name: string): string {
  const n = name.trim().toLowerCase();
  return n === "colors" ? "colours" : n;
}

export function findSections(doc: IniDoc, name: string): IniSection[] {
  const key = sectionKey(name);
  return doc.sections.filter((s) => sectionKey(s.name) === key);
}

export function findSection(doc: IniDoc, name: string): IniSection | null {
  return findSections(doc, name)[0] ?? null;
}

/** Case-insensitive value read. The last occurrence wins (matches the game's parser). */
export function getValue(section: IniSection, key: string): string | undefined {
  const lower = key.toLowerCase();
  let found: string | undefined;
  for (const line of section.lines) {
    if (line.kind === "kv" && line.key.toLowerCase() === lower) found = line.value;
  }
  return found;
}

/** Replace every occurrence of `key`, or append when absent. */
export function setValue(section: IniSection, key: string, value: string): void {
  const lower = key.toLowerCase();
  let replaced = false;
  const next: IniLine[] = [];
  for (const line of section.lines) {
    if (line.kind === "kv" && line.key.toLowerCase() === lower) {
      if (replaced) continue;
      next.push({ kind: "kv", key: line.key, value, raw: `${line.key}: ${value}` });
      replaced = true;
      continue;
    }
    next.push(line);
  }
  if (!replaced) next.push({ kind: "kv", key, value, raw: `${key}: ${value}` });
  section.lines = next;
}

export function removeKey(section: IniSection, key: string): void {
  const lower = key.toLowerCase();
  section.lines = section.lines.filter(
    (l) => !(l.kind === "kv" && l.key.toLowerCase() === lower),
  );
}

export function cloneSection(section: IniSection): IniSection {
  return { name: section.name, lines: section.lines.map((l) => ({ ...l })) };
}

export function newSection(name: string, entries: Array<[string, string]> = []): IniSection {
  return {
    name,
    lines: entries.map(([key, value]) => ({
      kind: "kv" as const,
      key,
      value,
      raw: `${key}: ${value}`,
    })),
  };
}

/** `[Mania]` blocks by `Keys:` (first block per key count wins). */
export function maniaBlocks(doc: IniDoc): Map<number, IniSection> {
  const out = new Map<number, IniSection>();
  for (const section of findSections(doc, "Mania")) {
    const keys = Number(getValue(section, "Keys"));
    if (!Number.isInteger(keys) || keys < 1 || keys > 18) continue;
    if (!out.has(keys)) out.set(keys, section);
  }
  return out;
}
