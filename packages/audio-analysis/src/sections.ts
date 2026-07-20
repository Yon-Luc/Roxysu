import type { AudioSection } from "./types";

/** Split the track into fixed windows ranked by RMS energy. */
export function detectSections(
  samples: Float32Array,
  sampleRate: number,
  windowSec = 8,
): AudioSection[] {
  if (samples.length === 0) return [];

  const windowSamples = Math.max(1, Math.floor(windowSec * sampleRate));
  const sections: AudioSection[] = [];

  for (let start = 0; start < samples.length; start += windowSamples) {
    const end = Math.min(samples.length, start + windowSamples);
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      const s = samples[i]!;
      sum += s * s;
    }
    const energy = Math.sqrt(sum / Math.max(1, end - start));
    sections.push({
      startMs: (start / sampleRate) * 1000,
      endMs: (end / sampleRate) * 1000,
      energy,
    });
  }

  return sections;
}
