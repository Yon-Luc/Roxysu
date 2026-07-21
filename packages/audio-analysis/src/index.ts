export {
  analyzeAudioFile,
  analyzeDecodedAudio,
  synthesizeImpulseTrack,
  synthesizeTwoTempoTrack,
} from "./analyzeAudio";
export { decodeAudioFile, isFfmpegAvailable } from "./ffmpeg";
export {
  ffmpegUnavailableMessage,
  findFlakeRoot,
  findProjectFlakeRoot,
  resetFfmpegPathCache,
  resolveFfmpegPath,
  resolveNixBinary,
} from "./resolveFfmpegPath";
export { detectOnsets, buildBeatGrid } from "./onsets";
export {
  estimateBpm,
  refineBeatsFromOnsets,
  resolveTimingOffsetMs,
} from "./beats";
export type { BpmEstimate } from "./beats";
export {
  estimateTempoMap,
  refineBeatsFromTempoMap,
  tempoMapToTimingPoints,
} from "./tempoMap";
export { detectSections } from "./sections";
export type {
  AudioAnalysisOptions,
  AudioAnalysisResult,
  AudioSection,
  BeatOnset,
  DecodeAudioOptions,
  DecodedAudio,
  TempoSegment,
} from "./types";
