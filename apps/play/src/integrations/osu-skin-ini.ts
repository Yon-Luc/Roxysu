/**
 * Re-exports osu! legacy skin.ini parsing used by Roxysu preview.
 * Canonical implementation: apps/server/public/lib/osuSkinIni.ts
 */
export {
  decodeSkinIniBytes,
  parseSkinIni,
  resolveManiaSection,
  noteImageCandidates,
  keyImageCandidates,
  stageImageCandidates,
  importedHitPositionFrac,
  layoutManiaPlayfield,
  OSU_MANIA_HEIGHT,
  DEFAULT_COLUMN_START,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_HIT_POSITION_PX,
  type ParsedSkinIni,
  type SkinIniManiaSection,
  type ManiaPlayfieldLayout,
} from "../../../server/public/lib/osuSkinIni";
