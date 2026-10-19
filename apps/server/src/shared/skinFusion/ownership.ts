/**
 * Which files of a skin belong to which ruleset slot.
 *
 * Two mechanisms:
 * - Name patterns for root-level files that lazer / osu!stable look up by a
 *   fixed name (`hitcircle`, `fruit-apple`, `taiko-drum-inner` ...).
 * - Ini references for files that a `[Mania]` block or `[Fonts]` key points
 *   at (any folder, backslash paths). These are `AssetRef`s so the resolver
 *   can move them and rewrite the ini value on a name conflict.
 */
import {
  AUDIO_EXTS,
  IMAGE_EXTS,
  PathIndex,
  basename,
  imageExtOf,
  normalizeRef,
  resolveFirstImage,
  resolveImageRef,
  type ResolvedImage,
} from "./fileMap";
import { getValue, type IniSection } from "./iniModel";

/** Slots that own a family of root-level files. */
export type PatternSlot = "osu" | "taiko" | "fruits";

export type FileClass = PatternSlot | "mania" | "shared" | "ignored";

const IGNORED_EXTS = new Set([
  "json", "ini", "txt", "md", "psd", "sfk", "db", "zip", "rar", "xcf", "ai",
  "log", "url", "html", "htm", "exe", "dll",
]);
const ASSET_EXTS = new Set<string>([...IMAGE_EXTS, ...AUDIO_EXTS, "webp"]);

const OSU_RE =
  /^(hitcircle|hitcircleoverlay|hitcircleselect|approachcircle|cursor|cursormiddle|cursortrail|cursor-smoke|sliderb|sliderb\d+|sliderb-nd|sliderb-spec|sliderfollowcircle|sliderpoint10|sliderpoint30|sliderscorepoint|slider(start|end)circle(overlay)?|reversearrow|followpoint|hit(0|50|100|300|100k|300k|300g)|particle(50|100|300)|spinner-.+|default-?\d|default-(comma|dot|percent|x))$/;
const TAIKO_RE = /^(taiko|pippidon)/;
const FRUITS_RE = /^(fruit-|lighting$|scoreboard-explosion)/;
const MANIA_RE = /^(mania-|lighting[nl]$|stage-)/;

export function fileExt(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i + 1).toLowerCase();
}

/** `Hit300@2x.PNG` -> `hit300`; frames (`hit300-1`) are also returned stripped. */
function logicalNames(path: string): string[] {
  const base = basename(path).toLowerCase();
  const dot = base.lastIndexOf(".");
  const noExt = dot < 0 ? base : base.slice(0, dot);
  const sd = noExt.replace(/@2x$/, "");
  const unframed = sd.replace(/-\d+$/, "");
  return unframed === sd ? [sd] : [sd, unframed];
}

/** True for image / audio files a skin can carry. */
export function isSkinAsset(path: string): boolean {
  return ASSET_EXTS.has(fileExt(path));
}

export function classifyFile(path: string): FileClass {
  const ext = fileExt(path);
  if (IGNORED_EXTS.has(ext) || !ASSET_EXTS.has(ext)) return "ignored";
  const names = logicalNames(path);
  const any = (re: RegExp) => names.some((n) => re.test(n));
  if (any(TAIKO_RE)) return "taiko";
  if (any(FRUITS_RE)) return "fruits";
  if (any(MANIA_RE)) return "mania";
  if (any(OSU_RE)) return "osu";
  return "shared";
}

export function isRootLevel(path: string): boolean {
  return !path.includes("/");
}

export type OwnedFile = { path: string; bytes: Uint8Array };

/** Root-level files of one pattern family. */
export function patternFiles(index: PathIndex, slot: PatternSlot): OwnedFile[] {
  const out: OwnedFile[] = [];
  for (const [path, bytes] of index.files) {
    if (!isRootLevel(path)) continue;
    if (classifyFile(path) === slot) out.push({ path, bytes });
  }
  return out;
}

/** Root-level files nobody else claims: score digits, menu art, hitsounds, ... */
export function sharedFiles(index: PathIndex): OwnedFile[] {
  const out: OwnedFile[] = [];
  for (const [path, bytes] of index.files) {
    if (!isRootLevel(path)) continue;
    if (classifyFile(path) === "shared") out.push({ path, bytes });
  }
  return out;
}

/** Skin file inventory used by the donor summary (list endpoint and UI). */
export function providedRulesets(paths: Iterable<string>): PatternSlot[] {
  const found = new Set<PatternSlot>();
  for (const path of paths) {
    if (!isRootLevel(path)) continue;
    const c = classifyFile(path);
    if (c === "osu" || c === "taiko" || c === "fruits") found.add(c);
  }
  return (["osu", "taiko", "fruits"] as const).filter((s) => found.has(s));
}

// ---------------------------------------------------------------------------
// Ini-referenced assets
// ---------------------------------------------------------------------------

export type IniRefTarget =
  | { section: "mania"; keys: number; key: string }
  | { section: "fonts"; key: string };

export type AssetRef = {
  /** Reference without extension (`7k/prayedit/mania-note2`). */
  base: string;
  files: OwnedFile[];
  /** Ini key that points at this asset (set explicitly when the asset is moved). */
  target: IniRefTarget;
  /** The block / section already named this asset (vs. an implicit default name). */
  named: boolean;
  /** Extension the original value carried (`.png`), re-applied on rewrite. */
  keyExt: string;
};

export function columnNoteType(keys: number, column: number): "1" | "2" | "S" {
  const patterns: Record<number, string> = {
    1: "S", 2: "11", 3: "121", 4: "1221", 5: "12S21", 6: "121121",
    7: "121S121", 8: "12122121", 9: "1212S2121", 10: "1212212121",
  };
  const pattern = patterns[keys] ?? "1".repeat(Math.max(1, keys));
  const ch = pattern[column % pattern.length] ?? "1";
  return ch === "2" || ch === "S" ? ch : "1";
}

export type ManiaRefSpec = { key: string; candidates: string[]; implicit: string };

/**
 * Every image key lazer reads from a `[Mania]` block, with the implicit
 * default name used when the block doesn't name the file. Hit lighting,
 * stage light, hit result and warning-arrow images are included, not just the
 * sprites Roxysu previews.
 */
export function maniaRefSpecs(
  keys: number,
  block: IniSection | null,
): ManiaRefSpec[] {
  const specs: ManiaRefSpec[] = [];
  const add = (key: string, implicit: string) => {
    const named = block ? getValue(block, key) : undefined;
    const candidates: string[] = [];
    if (named) candidates.push(named);
    if (!named || normalizeRef(named).toLowerCase() !== implicit.toLowerCase()) {
      candidates.push(implicit);
    }
    specs.push({ key, candidates, implicit });
  };
  for (let c = 0; c < keys; c += 1) {
    const t = columnNoteType(keys, c);
    add(`NoteImage${c}`, `mania-note${t}`);
    add(`NoteImage${c}H`, `mania-note${t}H`);
    add(`NoteImage${c}L`, `mania-note${t}L`);
    add(`NoteImage${c}T`, `mania-note${t}T`);
    add(`KeyImage${c}`, `mania-key${t}`);
    add(`KeyImage${c}D`, `mania-key${t}D`);
  }
  add("StageLeft", "mania-stage-left");
  add("StageRight", "mania-stage-right");
  add("StageHint", "mania-stage-hint");
  add("StageBottom", "mania-stage-bottom");
  add("StageLight", "mania-stage-light");
  add("LightingN", "lightingN");
  add("LightingL", "lightingL");
  add("WarningArrow", "mania-warningarrow");
  for (const hit of ["0", "50", "100", "200", "300", "300g"]) {
    add(`Hit${hit}`, `mania-hit${hit}`);
  }
  return specs;
}

/** Resolve every mania image reference of one key count against a donor. */
export function resolveManiaRefs(
  index: PathIndex,
  keys: number,
  block: IniSection | null,
): AssetRef[] {
  const refs: AssetRef[] = [];
  const seen = new Set<string>();
  for (const spec of maniaRefSpecs(keys, block)) {
    const hit = resolveFirstImage(index, spec.candidates);
    if (!hit) continue;
    const named = block ? getValue(block, spec.key) : undefined;
    const matchedNamed =
      !!named &&
      normalizeRef(named).toLowerCase() === normalizeRef(hit.candidate).toLowerCase();
    // Two keys can point at one file (`NoteImage0` and `NoteImage1`): each key
    // keeps its own ref so each gets rewritten, files dedupe in the resolver.
    const dedupe = `${spec.key.toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    refs.push({
      base: hit.base,
      files: hit.files,
      target: { section: "mania", keys, key: spec.key },
      named: matchedNamed,
      keyExt: matchedNamed ? imageExtOf(normalizeRef(named!)) : "",
    });
  }
  return refs;
}

const FONT_CHARS = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "comma", "dot", "percent", "x",
];

/**
 * Digit sprites a `[Fonts]` prefix points at (`ScorePrefix: score`). One
 * `AssetRef` for the whole prefix so every digit moves together and the ini
 * value is rewritten once. Null when no digit exists in the donor.
 */
export function fontPrefixRef(
  index: PathIndex,
  key: "HitCirclePrefix" | "ScorePrefix" | "ComboPrefix",
  prefix: string,
  chars: string[] = FONT_CHARS,
): AssetRef | null {
  const base = normalizeRef(prefix);
  const files: OwnedFile[] = [];
  for (const ch of chars) {
    const hit: ResolvedImage | null = resolveImageRef(index, `${base}-${ch}`);
    if (hit) files.push(...hit.files);
  }
  if (files.length === 0) return null;
  return { base, files, target: { section: "fonts", key }, named: true, keyExt: "" };
}

export const HIT_CIRCLE_CHARS = FONT_CHARS.slice(0, 10);
export const DEFAULT_FONT_PREFIX: Record<
  "HitCirclePrefix" | "ScorePrefix" | "ComboPrefix",
  string
> = { HitCirclePrefix: "default", ScorePrefix: "score", ComboPrefix: "score" };
