export type KeyBindings = {
  laneKeys: readonly string[];
};

export const DEFAULT_7K_BINDINGS: KeyBindings = {
  laneKeys: ["s", "d", "f", "space", "j", "k", "l"],
};

export function laneForKey(
  key: string,
  bindings: KeyBindings = DEFAULT_7K_BINDINGS,
): number | null {
  const normalized = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  const index = bindings.laneKeys.indexOf(normalized);
  return index >= 0 ? index : null;
}

export function keyForLane(
  lane: number,
  bindings: KeyBindings = DEFAULT_7K_BINDINGS,
): string | null {
  return bindings.laneKeys[lane] ?? null;
}
