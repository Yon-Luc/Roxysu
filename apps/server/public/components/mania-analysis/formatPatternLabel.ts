/**
 * Display labels for dominant-skill labels.
 *
 * Legacy Interlude names are still accepted so stored rows from an older
 * `algorithm` row keep rendering instead of showing raw snake_case.
 */
import { shapesForKeyCount } from "@roxysu/mania-difficulty";

const FALLBACK: Record<string, string> = {
  // current skill labels
  speed: "Speed",
  jack: "Jack",
  coordination: "Coordination",
  technical: "Technical",
  release: "Release",
  // retired Interlude labels (legacy rows)
  jumpstream: "Jumpstream",
  handstream: "Handstream",
  chordjack: "Chordjack",
  bracket: "Bracket",
  chordstream: "Chordstream",
  stream: "Stream",
  delay: "Delay",
  trill: "Trill",
  jumptrill: "Jumptrill",
  anchor: "Anchor",
  shield: "Shield",
  tech: "Tech",
  mixed: "Mixed",
};

export function formatPatternLabel(
  pattern: string,
  labels: Record<string, string> | undefined,
): string {
  if (!labels) return FALLBACK[pattern] ?? pattern;
  return labels[pattern] ?? FALLBACK[pattern] ?? pattern;
}

/** Skill labels, in canonical order, for the skill breakdown chart. */
export const SKILL_LABEL_ORDER = [
  "speed",
  "jack",
  "coordination",
  "technical",
  "release",
] as const;

export function weightPatternsForKeyCount(): readonly (typeof SKILL_LABEL_ORDER)[number][] {
  return SKILL_LABEL_ORDER;
}

/**
 * Chart-shape families shown as pattern weights, keymode-aware.
 *
 * Community terms differ per key count (osu! wiki pattern index): jumpstream
 * and handstream are 4K, bracket is 7K and other non-4K modes.
 */
export function shapePatternsForKeyCount(
  keyCount: number | null | undefined,
): readonly string[] {
  return shapesForKeyCount(keyCount);
}
