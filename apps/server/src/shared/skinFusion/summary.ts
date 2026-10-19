import { basename } from "./fileMap";
import { maniaBlocks, parseIniBytes } from "./iniModel";
import { COMPOSED_LAYOUT_FILES, SONG_SELECT_FILE } from "./layout";
import { isRootLevel, isSkinAsset, providedRulesets, type PatternSlot } from "./ownership";

export type SkinSummary = {
  /** Skin ships at least one image or sound. False for lazer layout-only "(modified)" skins. */
  hasAssets: boolean;
  /** Skin ships at least one lazer layout JSON. */
  hasLayout: boolean;
  /** Rulesets with root-level files (osu, taiko, fruits). Mania is `keyCounts`. */
  rulesets: PatternSlot[];
  /** `[Mania] Keys:` values defined in skin.ini. */
  keyCounts: number[];
};

const LAYOUT_NAMES = new Set(
  [...COMPOSED_LAYOUT_FILES, SONG_SELECT_FILE].map((n) => n.toLowerCase()),
);

/** Cheap inventory of a skin from its file names (and optional skin.ini bytes). */
export function summarizeSkin(
  filenames: Iterable<string>,
  iniBytes?: Uint8Array | null,
): SkinSummary {
  const names = [...filenames].map((n) => n.replace(/\\/g, "/"));
  let keyCounts: number[] = [];
  if (iniBytes) {
    try {
      keyCounts = [...maniaBlocks(parseIniBytes(iniBytes)).keys()].sort((a, b) => a - b);
    } catch {
      keyCounts = [];
    }
  }
  return {
    hasAssets: names.some((n) => isSkinAsset(n)),
    hasLayout: names.some((n) => isRootLevel(n) && LAYOUT_NAMES.has(basename(n).toLowerCase())),
    rulesets: providedRulesets(names),
    keyCounts,
  };
}
