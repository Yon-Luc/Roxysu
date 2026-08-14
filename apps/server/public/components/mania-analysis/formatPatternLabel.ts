const FALLBACK: Record<string, string> = {
  jack: "Jack",
  jumpstream: "Jumpstream",
  handstream: "Handstream",
  chordjack: "Chordjack",
  bracket: "Bracket",
  chordstream: "Chordstream",
  stream: "Stream",
  delay: "Delay",
  mixed: "Mixed",
};

export function formatPatternLabel(
  pattern: string,
  labels: Record<string, string> | undefined,
): string {
  if (!labels) return FALLBACK[pattern] ?? pattern;
  return labels[pattern] ?? pattern;
}

export function weightPatternsForKeyCount(
  keyCount: number | null,
): readonly (
  | "jack"
  | "chordjack"
  | "jumpstream"
  | "handstream"
  | "stream"
  | "delay"
  | "chordstream"
  | "bracket"
)[] {
  return keyCount === 4
    ? (["jack", "chordjack", "jumpstream", "handstream", "stream"] as const)
    : (["jack", "chordjack", "delay", "chordstream", "bracket"] as const);
}
