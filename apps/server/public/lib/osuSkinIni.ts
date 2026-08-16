export const OSU_MANIA_HEIGHT = 480;
export const DEFAULT_HIT_POSITION_PX = 402;
export const DEFAULT_COLUMN_WIDTH = 30;
export const DEFAULT_COLUMN_START = 136;

export type ColumnNoteType = "1" | "2" | "S";

export type SkinIniManiaSection = {
  keys: number;
  hitPosition: number;
  columnWidth: number[];
  columnSpacing: number[];
  columnLineWidth: number[];
  columnStart: number;
  noteImage: (string | undefined)[];
  noteImageH: (string | undefined)[];
  noteImageL: (string | undefined)[];
  noteImageT: (string | undefined)[];
  keyImage: (string | undefined)[];
  keyImageD: (string | undefined)[];
  stageLeft?: string;
  stageRight?: string;
  stageHint?: string;
  stageBottom?: string;
};

export type ParsedSkinIni = {
  name: string;
  mania: SkinIniManiaSection[];
};

const COLUMN_TYPES: Record<number, string> = {
  1: "S",
  2: "11",
  3: "121",
  4: "1221",
  5: "12S21",
  6: "121121",
  7: "121S121",
  8: "12122121",
  9: "1212S2121",
  10: "1212212121",
};

export function columnNoteType(keys: number, column: number): ColumnNoteType {
  const pattern = COLUMN_TYPES[keys] ?? "1".repeat(Math.max(1, keys));
  const ch = pattern[column % pattern.length] ?? "1";
  if (ch === "2" || ch === "S") return ch;
  return "1";
}

export function defaultNoteImageName(
  keys: number,
  column: number,
  part: "" | "H" | "L" | "T" = "",
): string {
  return `mania-note${columnNoteType(keys, column)}${part}`;
}

export function defaultKeyImageName(
  keys: number,
  column: number,
  down: boolean,
): string {
  return `mania-key${columnNoteType(keys, column)}${down ? "D" : ""}`;
}

export function decodeSkinIniBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes);
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  const sampleLen = Math.min(64, bytes.length);
  let zeros = 0;
  for (let i = 1; i < sampleLen; i += 2) {
    if (bytes[i] === 0) zeros += 1;
  }
  if (sampleLen >= 8 && zeros > sampleLen / 4) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function stripComment(line: string): string {
  const idx = line.search(/(^|\s)\/\//);
  if (idx < 0) return line;
  return line.slice(0, idx);
}

function parseNumberList(raw: string | undefined, fallback: number): number[] {
  if (!raw) return [];
  return raw.split(",").map((part) => {
    const n = Number(part.trim());
    return Number.isFinite(n) ? n : fallback;
  });
}

function padList(values: number[], length: number, fallback: number): number[] {
  if (length <= 0) return [];
  if (values.length === 0) return Array.from({ length }, () => fallback);
  return Array.from(
    { length },
    (_, i) => values[i] ?? values[values.length - 1] ?? fallback,
  );
}

function padOptional(values: (string | undefined)[], length: number): (string | undefined)[] {
  return Array.from({ length }, (_, i) => values[i]);
}

function readImageList(
  keys: Record<string, string>,
  prefix: string,
  count: number,
): (string | undefined)[] {
  return Array.from({ length: count }, (_, i) => {
    const raw = keys[`${prefix}${i}`];
    return raw && raw.length > 0 ? raw : undefined;
  });
}

function parseManiaSection(
  fields: Record<string, string>,
): SkinIniManiaSection | null {
  const keys = Number(fields.keys);
  if (!Number.isInteger(keys) || keys < 1 || keys > 18) return null;
  const columnWidth = padList(
    parseNumberList(fields.columnwidth, DEFAULT_COLUMN_WIDTH),
    keys,
    DEFAULT_COLUMN_WIDTH,
  );
  const columnSpacing = padList(
    parseNumberList(fields.columnspacing, 0),
    Math.max(0, keys - 1),
    0,
  );
  const columnLineWidth = padList(
    parseNumberList(fields.columnlinewidth, 2),
    keys + 1,
    2,
  );
  const hitPosition = Number(fields.hitposition);
  return {
    keys,
    hitPosition:
      Number.isFinite(hitPosition) && hitPosition > 0
        ? hitPosition
        : DEFAULT_HIT_POSITION_PX,
    columnWidth,
    columnSpacing,
    columnLineWidth,
    columnStart: Number.isFinite(Number(fields.columnstart))
      ? Number(fields.columnstart)
      : DEFAULT_COLUMN_START,
    noteImage: readImageList(fields, "noteimage", keys),
    noteImageH: readImageList(fields, "noteimage", keys).map((_, i) => {
      const raw = fields[`noteimage${i}h`];
      return raw && raw.length > 0 ? raw : undefined;
    }),
    noteImageL: Array.from({ length: keys }, (_, i) => {
      const raw = fields[`noteimage${i}l`];
      return raw && raw.length > 0 ? raw : undefined;
    }),
    noteImageT: Array.from({ length: keys }, (_, i) => {
      const raw = fields[`noteimage${i}t`];
      return raw && raw.length > 0 ? raw : undefined;
    }),
    keyImage: readImageList(fields, "keyimage", keys),
    keyImageD: Array.from({ length: keys }, (_, i) => {
      const raw = fields[`keyimage${i}d`];
      return raw && raw.length > 0 ? raw : undefined;
    }),
    stageLeft: fields.stageleft || undefined,
    stageRight: fields.stageright || undefined,
    stageHint: fields.stagehint || undefined,
    stageBottom: fields.stagebottom || undefined,
  };
}

export function parseSkinIni(text: string): ParsedSkinIni {
  const sections: { name: string; fields: Record<string, string> }[] = [];
  let current: { name: string; fields: Record<string, string> } | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      current = { name: sec[1]!.trim(), fields: {} };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf(":");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    current.fields[key] = value;
  }

  const general = sections.find(
    (s) => s.name.toLowerCase() === "general",
  )?.fields;
  const mania: SkinIniManiaSection[] = [];
  for (const section of sections) {
    if (section.name.toLowerCase() !== "mania") continue;
    const parsed = parseManiaSection(section.fields);
    if (parsed) mania.push(parsed);
  }

  return {
    name: general?.name?.trim() || "",
    mania,
  };
}

export function resolveManiaSection(
  sections: SkinIniManiaSection[],
  keys: number,
): SkinIniManiaSection {
  const exact = sections.find((s) => s.keys === keys);
  const source =
    exact ??
    sections.reduce<SkinIniManiaSection | null>((best, s) => {
      if (!best) return s;
      return Math.abs(s.keys - keys) < Math.abs(best.keys - keys) ? s : best;
    }, null);

  if (!source) {
    return {
      keys,
      hitPosition: DEFAULT_HIT_POSITION_PX,
      columnWidth: Array.from({ length: keys }, () => DEFAULT_COLUMN_WIDTH),
      columnSpacing: Array.from({ length: Math.max(0, keys - 1) }, () => 0),
      columnLineWidth: Array.from({ length: keys + 1 }, () => 2),
      columnStart: DEFAULT_COLUMN_START,
      noteImage: padOptional([], keys),
      noteImageH: padOptional([], keys),
      noteImageL: padOptional([], keys),
      noteImageT: padOptional([], keys),
      keyImage: padOptional([], keys),
      keyImageD: padOptional([], keys),
      stageLeft: "mania-stage-left",
      stageRight: "mania-stage-right",
      stageHint: "mania-stage-hint",
      stageBottom: "mania-stage-bottom",
    };
  }

  if (source.keys === keys) return source;

  const take = <T,>(arr: T[], fallback: T): T[] =>
    Array.from({ length: keys }, (_, i) => arr[i % Math.max(1, arr.length)] ?? fallback);

  return {
    keys,
    hitPosition: source.hitPosition,
    columnWidth: take(source.columnWidth, DEFAULT_COLUMN_WIDTH),
    columnSpacing: padList(source.columnSpacing, Math.max(0, keys - 1), 0),
    columnLineWidth: padList(source.columnLineWidth, keys + 1, 2),
    columnStart: source.columnStart,
    noteImage: take(source.noteImage, undefined),
    noteImageH: take(source.noteImageH, undefined),
    noteImageL: take(source.noteImageL, undefined),
    noteImageT: take(source.noteImageT, undefined),
    keyImage: take(source.keyImage, undefined),
    keyImageD: take(source.keyImageD, undefined),
    stageLeft: source.stageLeft,
    stageRight: source.stageRight,
    stageHint: source.stageHint,
    stageBottom: source.stageBottom,
  };
}

export function noteImageCandidates(
  section: SkinIniManiaSection,
  column: number,
  part: "" | "H" | "L" | "T",
): string[] {
  const named =
    part === "H"
      ? section.noteImageH[column]
      : part === "L"
        ? section.noteImageL[column]
        : part === "T"
          ? section.noteImageT[column]
          : section.noteImage[column];
  const fallback = defaultNoteImageName(section.keys, column, part);
  const out: string[] = [];
  if (named) out.push(named);
  if (!named || named !== fallback) out.push(fallback);
  return out;
}

export function keyImageCandidates(
  section: SkinIniManiaSection,
  column: number,
  down: boolean,
): string[] {
  const named = down ? section.keyImageD[column] : section.keyImage[column];
  const fallback = defaultKeyImageName(section.keys, column, down);
  const out: string[] = [];
  if (named) out.push(named);
  if (!named || named !== fallback) out.push(fallback);
  return out;
}

export function stageImageCandidates(
  section: SkinIniManiaSection,
  role: "left" | "right" | "hint" | "bottom",
): string[] {
  const named =
    role === "left"
      ? section.stageLeft
      : role === "right"
        ? section.stageRight
        : role === "hint"
          ? section.stageHint
          : section.stageBottom;
  const fallback =
    role === "left"
      ? "mania-stage-left"
      : role === "right"
        ? "mania-stage-right"
        : role === "hint"
          ? "mania-stage-hint"
          : "mania-stage-bottom";
  const out: string[] = [];
  if (named) out.push(named);
  if (!named || named !== fallback) out.push(fallback);
  return out;
}

export type ManiaColumnLayout = {
  x: number;
  w: number;
};

export type ManiaStageRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ManiaPlayfieldLayout = {
  columns: ManiaColumnLayout[];
  lines: number[];
  stageLeft: ManiaStageRect | null;
  stageRight: ManiaStageRect | null;
  receptorY: number;
};

function stageDrawWidth(
  canvasW: number,
  canvasH: number,
  size: { w: number; h: number } | null | undefined,
): number {
  if (!size || size.w <= 0 || size.h <= 0) return 0;
  const scaled = size.w * (canvasH / size.h);
  return Math.min(scaled, canvasW * 0.18);
}

export function layoutManiaPlayfield(args: {
  canvasW: number;
  canvasH: number;
  keys: number;
  columnWidth: number[];
  columnSpacing: number[];
  hitPositionPx: number;
  stageLeft?: { w: number; h: number } | null;
  stageRight?: { w: number; h: number } | null;
}): ManiaPlayfieldLayout {
  const keys = Math.max(1, args.keys);
  const leftW = stageDrawWidth(args.canvasW, args.canvasH, args.stageLeft);
  const rightW = stageDrawWidth(args.canvasW, args.canvasH, args.stageRight);
  const innerW = Math.max(1, args.canvasW - leftW - rightW);

  const widths = padList(args.columnWidth, keys, DEFAULT_COLUMN_WIDTH).map((w) =>
    Math.max(1, w),
  );
  const gaps = padList(args.columnSpacing, Math.max(0, keys - 1), 0);
  const content = widths.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  const scale = innerW / Math.max(1, content);

  const columns: ManiaColumnLayout[] = [];
  let x = leftW;
  const lines: number[] = [x];
  for (let i = 0; i < keys; i += 1) {
    const w = widths[i]! * scale;
    columns.push({ x, w });
    x += w;
    if (i < keys - 1) x += (gaps[i] ?? 0) * scale;
    lines.push(x);
  }

  const receptorY = args.canvasH * (args.hitPositionPx / OSU_MANIA_HEIGHT);

  return {
    columns,
    lines,
    stageLeft:
      leftW > 0
        ? { x: 0, y: 0, w: leftW, h: args.canvasH }
        : null,
    stageRight:
      rightW > 0
        ? { x: args.canvasW - rightW, y: 0, w: rightW, h: args.canvasH }
        : null,
    receptorY,
  };
}

export function importedHitPositionFrac(hitPositionPx: number): number {
  if (!Number.isFinite(hitPositionPx) || hitPositionPx <= 0) {
    return DEFAULT_HIT_POSITION_PX / OSU_MANIA_HEIGHT;
  }
  return Math.min(0.98, Math.max(0.35, hitPositionPx / OSU_MANIA_HEIGHT));
}
