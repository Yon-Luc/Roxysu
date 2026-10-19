/**
 * Display labels for dominant-skill labels.
 *
 * Legacy Interlude names are still accepted so stored rows from an older
 * `algorithm` row keep rendering instead of showing raw snake_case.
 */
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

/** Chart-shape families shown as pattern weights. Bracket is 7K; handstream is 4K. */
const SHAPE_LABEL_ORDER_4K = [
  "stream",
  "trill",
  "jumptrill",
  "jumpstream",
  "handstream",
  "chordjack",
  "chordstream",
] as const;

const SHAPE_LABEL_ORDER_7K = [
  "stream",
  "trill",
  "jumptrill",
  "jumpstream",
  "chordjack",
  "chordstream",
  "bracket",
] as const;

const SHAPE_LABEL_ORDER = [
  ...SHAPE_LABEL_ORDER_4K,
  "bracket",
] as const;

export function shapePatternsForKeyCount(
  keyCount: number | null | undefined,
): readonly string[] {
  const keys = keyCount != null ? Math.round(keyCount) : null;
  if (keys === 4) return SHAPE_LABEL_ORDER_4K;
  if (keys === 7) return SHAPE_LABEL_ORDER_7K;
  return SHAPE_LABEL_ORDER;
}