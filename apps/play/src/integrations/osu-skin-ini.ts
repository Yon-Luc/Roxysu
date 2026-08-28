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
  OSU_MANIA_HEIGHT,
  type ParsedSkinIni,
  type SkinIniManiaSection,
} from "../../../server/public/lib/osuSkinIni";
