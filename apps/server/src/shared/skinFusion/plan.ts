/**
 * Skin fusion planner: combine donor skins into one set of output files
 * (`skin.ini`, layout JSON, images, sounds) for a lazer-importable `.osk`.
 *
 * Pure and synchronous. Ordering rules that keep donors from overwriting
 * each other:
 *   1. shared files (base) are placed first and never move
 *   2. root-level pattern files (osu / taiko / fruits) are placed next and never move
 *   3. ini-referenced and layout-referenced files are placed last and MOVE
 *      (namespaced folder / renamed file) when their path is already taken by
 *      different bytes; the ini value or `sprite_name` is rewritten to match.
 */
import {
  PathIndex,
  bytesEqual,
  resolveImageRef,
  type SkinFiles,
} from "./fileMap";
import {
  cloneSection,
  findSection,
  findSections,
  getValue,
  iniToBytes,
  maniaBlocks,
  newSection,
  parseIniBytes,
  removeKey,
  sectionKey,
  setValue,
  type IniDoc,
  type IniSection,
} from "./iniModel";
import {
  COMPOSED_LAYOUT_FILES,
  SKIN_INFO_FILE,
  SONG_SELECT_FILE,
  collectSpriteNames,
  customRulesetTypes,
  layoutKeySlot,
  layoutVersion,
  parseLayout,
  pickLayoutEntries,
  type LayoutEntry,
  rewriteSpriteNames,
  serializeLayout,
  type LayoutDoc,
} from "./layout";
import {
  DEFAULT_FONT_PREFIX,
  HIT_CIRCLE_CHARS,
  fontPrefixRef,
  isSkinAsset,
  patternFiles,
  resolveManiaRefs,
  sharedFiles,
  type AssetRef,
  type OwnedFile,
  type PatternSlot,
} from "./ownership";

export const NONE_DONOR = "__none__";
export const LEGACY_INSTANTIATION = "osu.Game.Skinning.LegacySkin, osu.Game";
export const DEFAULT_MAX_BYTES = 400 * 1024 * 1024;

export type SlotId =
  | "base"
  | "osu"
  | "taiko"
  | "fruits"
  | "bms"
  | "songSelect"
  | "hudGlobal"
  | "maniaLayout"
  | `mania:${number}`;

export type SkinDonor = {
  id: string;
  label: string;
  creator: string | null;
  /** Skin-root-relative files. */
  files: SkinFiles;
  ini: IniDoc | null;
  /** Parsed composed layout files by canonical file name. */
  layouts: Map<string, LayoutDoc | null>;
  songSelect: Uint8Array | null;
  instantiationInfo: string | null;
  /** Carries at least one image or sound. False for lazer layout-only "(modified)" skins. */
  hasAssets: boolean;
};

export type ManiaNamespacing = "auto" | "always" | "never";

export type FusionInput = {
  name: string;
  creator: string;
  donors: SkinDonor[];
  baseId: string;
  slots: Partial<Record<SlotId, string>>;
  options?: {
    /** Move every mania image into a per-donor folder (`auto`: only when mania slots use 2+ donors). */
    maniaNamespacing?: ManiaNamespacing;
    maxBytes?: number;
  };
};

export type FusionReport = {
  slots: Array<{ slot: string; donor: string | null }>;
  maniaNamespaced: boolean;
  relocated: Array<{ from: string; to: string; donor: string; reason: string }>;
  dropped: Array<{ path: string; donor: string; reason: string }>;
  droppedCount: number;
  warnings: string[];
  fileCount: number;
  totalBytes: number;
};

export type FusionResult = {
  files: Map<string, Uint8Array>;
  report: FusionReport;
};

const DROPPED_LIST_CAP = 200;

// ---------------------------------------------------------------------------
// Donor construction
// ---------------------------------------------------------------------------

export function buildDonor(args: {
  id: string;
  label: string;
  creator?: string | null;
  /** Files already relative to the skin root (see `rebaseToSkinRoot`). */
  files: SkinFiles;
}): SkinDonor {
  const index = new PathIndex(args.files);
  const iniBytes = index.get("skin.ini");
  let ini: IniDoc | null = null;
  if (iniBytes) {
    try {
      ini = parseIniBytes(iniBytes);
    } catch {
      ini = null;
    }
  }
  const layouts = new Map<string, LayoutDoc | null>();
  for (const name of COMPOSED_LAYOUT_FILES) {
    const bytes = index.get(name);
    layouts.set(name, bytes ? parseLayout(bytes) : null);
  }
  let instantiationInfo: string | null = null;
  const infoBytes = index.get(SKIN_INFO_FILE);
  if (infoBytes) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(infoBytes)) as {
        InstantiationInfo?: unknown;
      };
      if (typeof parsed.InstantiationInfo === "string") {
        instantiationInfo = parsed.InstantiationInfo;
      }
    } catch {
      // keep null
    }
  }
  let hasAssets = false;
  for (const path of args.files.keys()) {
    if (isSkinAsset(path)) {
      hasAssets = true;
      break;
    }
  }
  return {
    id: args.id,
    label: args.label,
    creator: args.creator ?? (ini ? findGeneral(ini, "Author") : null),
    files: args.files,
    ini,
    layouts,
    songSelect: index.get(SONG_SELECT_FILE),
    instantiationInfo,
    hasAssets,
  };
}

function findGeneral(ini: IniDoc, key: string): string | null {
  const section = findSection(ini, "General");
  return (section && getValue(section, key)) || null;
}

/** Mania key counts a donor defines in `skin.ini`. */
export function donorManiaKeys(donor: SkinDonor): number[] {
  return donor.ini ? [...maniaBlocks(donor.ini).keys()].sort((a, b) => a - b) : [];
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

type OutEntry = { path: string; bytes: Uint8Array; donorId: string };

function slug(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return s || "skin";
}

function toBackslash(path: string): string {
  return path.replace(/\//g, "\\");
}

const GENERAL_COMPARE_SKIP = new Set(["name", "author", "version"]);

export function maniaSlotId(keys: number): SlotId {
  return `mania:${keys}`;
}

export function planFusion(input: FusionInput): FusionResult {
  const donors = new Map(input.donors.map((d) => [d.id, d]));
  const base = donors.get(input.baseId);
  if (!base) throw new Error("Choose a base skin");
  const dirs = new Map<string, string>();
  input.donors.forEach((d, i) => dirs.set(d.id, `d${i}-${slug(d.label)}`));
  const indexes = new Map<string, PathIndex>();
  const indexOf = (d: SkinDonor) => {
    let idx = indexes.get(d.id);
    if (!idx) {
      idx = new PathIndex(d.files);
      indexes.set(d.id, idx);
    }
    return idx;
  };

  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };

  const donorFor = (slot: SlotId): SkinDonor | null => {
    const chosen = input.slots[slot] ?? input.baseId;
    if (chosen === NONE_DONOR) return null;
    const d = donors.get(chosen);
    if (!d) throw new Error(`Unknown skin for slot ${slot}`);
    return d;
  };

  // ---- Mania key counts and namespacing ------------------------------------
  const maniaKeys = new Set<number>();
  for (const slot of Object.keys(input.slots)) {
    const m = /^mania:(\d+)$/.exec(slot);
    if (m) maniaKeys.add(Number(m[1]));
  }
  if (base.ini) for (const k of maniaBlocks(base.ini).keys()) maniaKeys.add(k);
  const sortedKeys = [...maniaKeys].sort((a, b) => a - b);
  const maniaDonors = new Map<number, SkinDonor>();
  for (const k of sortedKeys) {
    const d = donorFor(maniaSlotId(k));
    if (d) maniaDonors.set(k, d);
  }
  const distinctManiaDonors = new Set([...maniaDonors.values()].map((d) => d.id));
  const nsMode = input.options?.maniaNamespacing ?? "auto";
  const maniaNamespaced =
    nsMode === "always" || (nsMode === "auto" && distinctManiaDonors.size >= 2);

  // ---- Placement state -----------------------------------------------------
  const out = new Map<string, OutEntry>();
  const relocated: FusionReport["relocated"] = [];
  const dropped: FusionReport["dropped"] = [];
  let droppedCount = 0;
  const placedSources = new Set<string>();
  const maniaRewrites = new Map<number, Map<string, string>>();
  const fontRewrites = new Map<string, string>();

  const noteDrop = (path: string, donor: SkinDonor, reason: string) => {
    droppedCount += 1;
    if (dropped.length < DROPPED_LIST_CAP) dropped.push({ path, donor: donor.label, reason });
  };

  const conflicts = (path: string, bytes: Uint8Array): boolean => {
    const existing = out.get(path.toLowerCase());
    return !!existing && !bytesEqual(existing.bytes, bytes);
  };

  const put = (path: string, bytes: Uint8Array, donor: SkinDonor, srcPath: string) => {
    placedSources.add(`${donor.id}\u0000${srcPath.toLowerCase()}`);
    const key = path.toLowerCase();
    if (!out.has(key)) out.set(key, { path, bytes, donorId: donor.id });
  };

  /** Pattern / shared files never move: first writer of a path wins. */
  const placeFixed = (files: OwnedFile[], donor: SkinDonor) => {
    for (const file of files) {
      if (conflicts(file.path, file.bytes)) {
        noteDrop(file.path, donor, "name conflict with a file already placed");
        warn(`Name conflict: ${file.path} from ${donor.label} was skipped (another skin already supplies it).`);
        continue;
      }
      put(file.path, file.bytes, donor, file.path);
    }
  };

  /**
   * Place a movable asset. Returns the folder it ended up in ("" = original
   * place). `forceMove` namespaces it unconditionally.
   */
  const placeRef = (ref: AssetRef, donor: SkinDonor, forceMove: boolean): string => {
    const dir = `fusion/${dirs.get(donor.id)}`;
    const clash = !forceMove && ref.files.some((f) => conflicts(f.path, f.bytes));
    const move = forceMove || clash;
    for (const file of ref.files) {
      const target = move ? `${dir}/${file.path}` : file.path;
      if (conflicts(target, file.bytes)) {
        noteDrop(target, donor, "name conflict inside the namespaced folder");
        continue;
      }
      put(target, file.bytes, donor, file.path);
      if (move) {
        relocated.push({
          from: file.path,
          to: target,
          donor: donor.label,
          reason: forceMove ? "mania namespacing" : "name conflict",
        });
      }
    }
    return move ? dir : "";
  };

  const refValue = (ref: AssetRef, dir: string): string =>
    toBackslash(`${dir ? `${dir}/` : ""}${ref.base}${ref.keyExt}`);

  const recordRewrite = (ref: AssetRef, dir: string) => {
    if (!dir) return;
    const value = refValue(ref, dir);
    if (ref.target.section === "mania") {
      let m = maniaRewrites.get(ref.target.keys);
      if (!m) {
        m = new Map();
        maniaRewrites.set(ref.target.keys, m);
      }
      m.set(ref.target.key, value);
    } else {
      fontRewrites.set(ref.target.key, value);
    }
  };

  // ---- Priority 0: shared files + shared digit fonts (base) ---------------
  placeFixed(sharedFiles(indexOf(base)), base);

  const baseFonts = base.ini ? findSection(base.ini, "Fonts") : null;
  for (const key of ["ScorePrefix", "ComboPrefix"] as const) {
    const prefix = (baseFonts && getValue(baseFonts, key)) || DEFAULT_FONT_PREFIX[key];
    // Root-level default digits are already placed as shared files.
    const ref = fontPrefixRef(indexOf(base), key, prefix);
    if (ref) recordRewrite(ref, placeRef(ref, base, false));
  }

  // ---- Priority 1: ruleset pattern files ----------------------------------
  const usedDonorsForImages = new Map<string, string[]>();
  const noteUse = (d: SkinDonor, slot: string) => {
    const list = usedDonorsForImages.get(d.id) ?? [];
    list.push(slot);
    usedDonorsForImages.set(d.id, list);
  };
  noteUse(base, "base");

  for (const slot of ["osu", "taiko", "fruits"] as PatternSlot[]) {
    const donor = donorFor(slot);
    if (!donor) continue;
    noteUse(donor, slot);
    const files = patternFiles(indexOf(donor), slot);
    if (files.length === 0 && donor.id !== base.id) {
      warn(`${donor.label} has no ${slot} files; ${slot} will fall back to the game default.`);
    }
    placeFixed(files, donor);
  }

  // ---- Priority 2: hit circle number prefix (osu donor) -------------------
  const osuDonor = donorFor("osu");
  let osuFonts: IniSection | null = null;
  if (osuDonor?.ini) osuFonts = findSection(osuDonor.ini, "Fonts");
  const hitPrefix = (osuFonts && getValue(osuFonts, "HitCirclePrefix")) || DEFAULT_FONT_PREFIX.HitCirclePrefix;
  if (osuDonor) {
    const ref = fontPrefixRef(indexOf(osuDonor), "HitCirclePrefix", hitPrefix, HIT_CIRCLE_CHARS);
    if (ref) recordRewrite(ref, placeRef(ref, osuDonor, false));
  }

  // ---- Layout selection ----------------------------------------------------
  const maniaLayoutDonorId = (() => {
    const explicit = input.slots.maniaLayout;
    if (explicit) return explicit === NONE_DONOR ? null : explicit;
    for (const k of sortedKeys) {
      const d = maniaDonors.get(k);
      if (d) return d.id;
    }
    return input.baseId;
  })();
  const slotDonorId = (slot: SlotId): string | null => donorFor(slot)?.id ?? null;
  const pickDonor = (key: string): string | null => {
    switch (layoutKeySlot(key)) {
      case "global":
        return slotDonorId("hudGlobal");
      case "osu":
        return slotDonorId("osu");
      case "taiko":
        return slotDonorId("taiko");
      case "fruits":
        return slotDonorId("fruits");
      case "mania":
        return maniaLayoutDonorId;
      case "bms":
        return slotDonorId("bms");
    }
  };

  type LayoutHolder = {
    key: string;
    entries: LayoutEntry[];
    renames: Map<string, string>;
  };
  type ComposedLayout = { file: string; doc: LayoutDoc; holders: LayoutHolder[] };
  const composedLayouts: ComposedLayout[] = [];
  const layoutDonorsUsed = new Set<string>();
  const spriteJobs: Array<{
    donor: SkinDonor;
    name: string;
    onRename: (to: string) => void;
  }> = [];

  for (const file of COMPOSED_LAYOUT_FILES) {
    const docs = new Map<string, LayoutDoc | null>();
    for (const d of input.donors) docs.set(d.id, d.layouts.get(file) ?? null);
    const picks = pickLayoutEntries(docs, pickDonor);
    if (picks.length === 0) continue;
    const contributing = new Set(picks.map((p) => p.donorId));
    for (const id of contributing) layoutDonorsUsed.add(id);
    const doc: LayoutDoc = {
      Version: layoutVersion(docs, contributing),
      DrawableInfo: {},
    };
    // Entries are rewritten after sprite placement; keep a mutable holder per pick.
    const holders: LayoutHolder[] = picks.map((p) => ({
      key: p.key,
      entries: p.entries,
      renames: new Map<string, string>(),
    }));
    picks.forEach((p, i) => {
      const donor = donors.get(p.donorId)!;
      for (const name of collectSpriteNames(p.entries)) {
        spriteJobs.push({
          donor,
          name,
          onRename: (to) => holders[i]!.renames.set(name, to),
        });
      }
    });
    composedLayouts.push({ file, doc, holders });
  }

  // ---- Priority 3: sprites referenced by layout components ----------------
  for (const job of spriteJobs) {
    const hit = resolveImageRef(indexOf(job.donor), job.name);
    if (!hit) {
      warn(`Layout sprite "${job.name}" from ${job.donor.label} was not found in that skin.`);
      continue;
    }
    const clash = hit.files.some((f) => conflicts(f.path, f.bytes));
    if (!clash) {
      for (const f of hit.files) put(f.path, f.bytes, job.donor, f.path);
      continue;
    }
    const suffix = `__${dirs.get(job.donor.id)}`;
    const newBase = `${hit.base}${suffix}`;
    for (const f of hit.files) {
      const rest = f.path.slice(hit.base.length);
      const target = `${newBase}${rest}`;
      put(target, f.bytes, job.donor, f.path);
      relocated.push({ from: f.path, to: target, donor: job.donor.label, reason: "layout sprite name conflict" });
    }
    const dot = job.name.lastIndexOf(".");
    const hasExt = dot > job.name.lastIndexOf("/") && dot > 0;
    const renamed = hasExt
      ? `${job.name.slice(0, dot)}${suffix}${job.name.slice(dot)}`
      : `${job.name}${suffix}`;
    job.onRename(renamed);
  }

  // ---- Priority 4: mania images -------------------------------------------
  const maniaBlockOf = new Map<number, IniSection | null>();
  for (const k of sortedKeys) {
    const donor = maniaDonors.get(k);
    if (!donor) continue;
    noteUse(donor, `mania:${k}`);
    const block = donor.ini ? (maniaBlocks(donor.ini).get(k) ?? null) : null;
    maniaBlockOf.set(k, block);
    const refs = resolveManiaRefs(indexOf(donor), k, block);
    for (const ref of refs) {
      recordRewrite(ref, placeRef(ref, donor, maniaNamespaced));
    }
  }

  // ---- skin.ini ------------------------------------------------------------
  const doc: IniDoc = {
    preamble: [],
    sections: [],
    bom: base.ini?.bom ?? false,
    eol: base.ini?.eol ?? "\r\n",
  };
  const general = base.ini && findSection(base.ini, "General")
    ? cloneSection(findSection(base.ini, "General")!)
    : newSection("General");
  setValue(general, "Name", input.name);
  setValue(general, "Author", input.creator || "Roxysu skin fusion");
  doc.sections.push(general);

  if (base.ini) {
    for (const section of base.ini.sections) {
      const key = sectionKey(section.name);
      if (key === "general" || key === "mania" || key === "catchthebeat") continue;
      doc.sections.push(cloneSection(section));
    }
  }

  // [Fonts]: hit circle prefix follows the osu donor, digits stay with base.
  let fonts = findSection(doc, "Fonts");
  const ensureFonts = (): IniSection => {
    if (!fonts) {
      fonts = newSection("Fonts");
      doc.sections.push(fonts);
    }
    return fonts;
  };
  if (osuDonor && osuDonor.id !== base.id) {
    for (const key of ["HitCirclePrefix", "HitCircleOverlap"]) {
      const value = osuFonts ? getValue(osuFonts, key) : undefined;
      if (value !== undefined) setValue(ensureFonts(), key, value);
      else if (fonts) removeKey(fonts, key);
    }
  } else if (!osuDonor && fonts) {
    removeKey(fonts, "HitCirclePrefix");
    removeKey(fonts, "HitCircleOverlap");
  }
  for (const [key, value] of fontRewrites) setValue(ensureFonts(), key, value);

  // [CatchTheBeat] from the fruits donor.
  const fruitsDonor = donorFor("fruits");
  if (fruitsDonor?.ini) {
    for (const section of findSections(fruitsDonor.ini, "CatchTheBeat")) {
      doc.sections.push(cloneSection(section));
    }
  }

  // [Mania] blocks.
  for (const k of sortedKeys) {
    const donor = maniaDonors.get(k);
    if (!donor) continue;
    const rewrites = maniaRewrites.get(k);
    const source = maniaBlockOf.get(k) ?? null;
    if (!source && !rewrites) continue;
    const block = source ? cloneSection(source) : newSection("Mania", [["Keys", String(k)]]);
    if (rewrites) for (const [key, value] of rewrites) setValue(block, key, value);
    doc.sections.push(block);
  }

  // ---- Layout JSON ----------------------------------------------------------
  const outputExtras = new Map<string, Uint8Array>();
  for (const composed of composedLayouts) {
    for (const holder of composed.holders) {
      composed.doc.DrawableInfo[holder.key] =
        holder.renames.size > 0
          ? rewriteSpriteNames(holder.entries, holder.renames)
          : holder.entries;
    }
    outputExtras.set(composed.file, serializeLayout(composed.doc));
  }

  const customTypes = new Set<string>();
  for (const composed of composedLayouts) {
    for (const holder of composed.holders) {
      for (const t of customRulesetTypes(holder.entries)) customTypes.add(t);
    }
  }
  if (customTypes.size > 0) {
    warn(
      `Layout components from custom rulesets (${[...customTypes].join(", ")}). If that ruleset is not installed in lazer, the game ignores the whole layout file.`,
    );
  }

  const songSelectDonor = donorFor("songSelect");
  if (songSelectDonor?.songSelect) {
    outputExtras.set(SONG_SELECT_FILE, songSelectDonor.songSelect);
    layoutDonorsUsed.add(songSelectDonor.id);
  }

  outputExtras.set("skin.ini", iniToBytes(doc));
  outputExtras.set(
    SKIN_INFO_FILE,
    new TextEncoder().encode(
      `${JSON.stringify(
        {
          Name: input.name,
          Creator: input.creator || "Roxysu skin fusion",
          InstantiationInfo: LEGACY_INSTANTIATION,
        },
        null,
        2,
      )}\n`,
    ),
  );

  // ---- Warnings -------------------------------------------------------------
  const imageSlotsOf = (d: SkinDonor) => usedDonorsForImages.get(d.id) ?? [];
  for (const d of input.donors) {
    const slots = imageSlotsOf(d);
    if (slots.length > 0 && !d.hasAssets) {
      warn(
        `${d.label} has no images or sounds (a lazer layout-only skin) but is used for ${slots.join(", ")}; those slots fall back to the game default.`,
      );
    }
  }

  const generalOf = (d: SkinDonor): IniSection | null =>
    d.ini ? findSection(d.ini, "General") : null;
  const baseGeneral = generalOf(base);
  const usedDonors = new Map<string, SkinDonor>();
  for (const id of usedDonorsForImages.keys()) usedDonors.set(id, donors.get(id)!);
  for (const id of layoutDonorsUsed) usedDonors.set(id, donors.get(id)!);
  usedDonors.delete(base.id);

  const versionOf = (d: SkinDonor) => {
    const g = generalOf(d);
    return (g && getValue(g, "Version")) || "";
  };
  const baseVersion = versionOf(base);
  const versionClash = [...usedDonors.values()].filter((d) => versionOf(d) !== baseVersion);
  if (versionClash.length > 0) {
    warn(
      `skin.ini Version differs from the base (${baseVersion || "unset"}): ${versionClash
        .map((d) => `${d.label} = ${versionOf(d) || "unset"}`)
        .join(", ")}. The game applies the base Version to every ruleset (for example mania hit lighting scale changes below 2.5), so those slots can look different.`,
    );
  }

  const diffs: string[] = [];
  for (const d of usedDonors.values()) {
    if (!imageSlotsOf(d).some((s) => s !== "base")) continue;
    const g = generalOf(d);
    if (!g) continue;
    const keys = new Set<string>();
    for (const line of g.lines) if (line.kind === "kv") keys.add(line.key.toLowerCase());
    if (baseGeneral) for (const line of baseGeneral.lines) if (line.kind === "kv") keys.add(line.key.toLowerCase());
    for (const key of keys) {
      if (GENERAL_COMPARE_SKIP.has(key)) continue;
      const a = baseGeneral ? getValue(baseGeneral, key) : undefined;
      const b = getValue(g, key);
      if (a !== b) diffs.push(`${key} (base ${a ?? "unset"}, ${d.label} ${b ?? "unset"})`);
    }
  }
  if (diffs.length > 0) {
    warn(
      `[General] is global in skin.ini, so the base values win for: ${diffs.slice(0, 12).join("; ")}${diffs.length > 12 ? "; ..." : ""}.`,
    );
  }

  if (fruitsDonor && fruitsDonor.id !== base.id) {
    const colours = (d: SkinDonor) => (d.ini ? findSection(d.ini, "Colours") : null);
    const a = colours(base);
    const b = colours(fruitsDonor);
    const combos = (s: IniSection | null) =>
      Array.from({ length: 8 }, (_, i) => (s ? getValue(s, `Combo${i + 1}`) ?? "" : "")).join("|");
    if (combos(a) !== combos(b)) {
      warn(`Combo colours come from the base; ${fruitsDonor.label} (fruits) uses different ones.`);
    }
  }

  if (maniaLayoutDonorId) {
    const disagree = sortedKeys.filter((k) => {
      const d = maniaDonors.get(k);
      return d && d.id !== maniaLayoutDonorId;
    });
    if (disagree.length > 0) {
      warn(
        `Mania layout comes from ${donors.get(maniaLayoutDonorId)?.label}; ${disagree.map((k) => `${k}K`).join(", ")} use a different skin for images. Lazer keeps one mania layout for all key counts.`,
      );
    }
  }

  for (const k of sortedKeys) {
    const d = maniaDonors.get(k);
    if (d && !maniaBlockOf.get(k) && d.ini) {
      warn(`${d.label} has no [Mania] block for ${k}K; its images are used with the game's default layout numbers.`);
    }
  }

  // ---- Unplaced donor files --------------------------------------------------
  for (const id of usedDonorsForImages.keys()) {
    const d = donors.get(id)!;
    for (const path of d.files.keys()) {
      if (!isSkinAsset(path)) continue;
      if (placedSources.has(`${d.id}\u0000${path.toLowerCase()}`)) continue;
      noteDrop(path, d, "not used by any selected slot");
    }
  }

  // ---- Assemble output ---------------------------------------------------------
  const files = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const entry of out.values()) {
    files.set(entry.path, entry.bytes);
    totalBytes += entry.bytes.length;
  }
  for (const [path, bytes] of outputExtras) {
    files.set(path, bytes);
    totalBytes += bytes.length;
  }
  const credits = buildCredits(input, usedDonors, base);
  files.set("credits.txt", credits);
  totalBytes += credits.length;

  const maxBytes = input.options?.maxBytes ?? DEFAULT_MAX_BYTES;
  if (totalBytes > maxBytes) {
    throw new Error(
      `Fused skin is ${(totalBytes / 1048576).toFixed(0)} MB, over the ${(maxBytes / 1048576).toFixed(0)} MB limit.`,
    );
  }

  const slotRows: FusionReport["slots"] = [{ slot: "base", donor: base.label }];
  for (const slot of ["osu", "taiko", "fruits", "bms", "songSelect", "hudGlobal"] as SlotId[]) {
    slotRows.push({ slot, donor: donorFor(slot)?.label ?? null });
  }
  slotRows.push({
    slot: "maniaLayout",
    donor: maniaLayoutDonorId ? (donors.get(maniaLayoutDonorId)?.label ?? null) : null,
  });
  for (const k of sortedKeys) {
    slotRows.push({ slot: maniaSlotId(k), donor: maniaDonors.get(k)?.label ?? null });
  }

  return {
    files,
    report: {
      slots: slotRows,
      maniaNamespaced,
      relocated,
      dropped,
      droppedCount,
      warnings,
      fileCount: files.size,
      totalBytes,
    },
  };
}

function buildCredits(
  input: FusionInput,
  used: Map<string, SkinDonor>,
  base: SkinDonor,
): Uint8Array {
  const lines = [input.name, "Created with Roxysu skin fusion.", "", "Source skins:"];
  const list = [base, ...[...used.values()].filter((d) => d.id !== base.id)];
  for (const d of list) {
    lines.push(`- ${d.label}${d.creator ? ` by ${d.creator}` : ""}`);
  }
  lines.push("", "All artwork and sounds belong to their original authors.");
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

/** Plain-text report written into the `.osk` as `fusion-report.txt`. */
export function formatReport(report: FusionReport): string {
  const lines: string[] = ["Roxysu skin fusion report", ""];
  lines.push("Slots:");
  for (const s of report.slots) lines.push(`  ${s.slot}: ${s.donor ?? "(none)"}`);
  lines.push("", `Mania images ${report.maniaNamespaced ? "moved into per-skin folders" : "kept at original paths"}.`);
  lines.push(`Files: ${report.fileCount}, ${(report.totalBytes / 1048576).toFixed(1)} MB`);
  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  if (report.relocated.length > 0) {
    lines.push("", `Moved or renamed files (${report.relocated.length}):`);
    for (const r of report.relocated.slice(0, 300)) lines.push(`  ${r.from} -> ${r.to} (${r.donor}; ${r.reason})`);
    if (report.relocated.length > 300) lines.push("  ...");
  }
  if (report.droppedCount > 0) {
    lines.push("", `Left out (${report.droppedCount}):`);
    for (const d of report.dropped) lines.push(`  ${d.path} (${d.donor}; ${d.reason})`);
  }
  return `${lines.join("\n")}\n`;
}

